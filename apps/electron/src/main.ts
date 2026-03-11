import { app, BrowserWindow, Tray, Menu, nativeImage, dialog } from 'electron';
import path from 'path';
import os from 'node:os';
import { fileURLToPath } from 'url';
import { spawn, type ChildProcess } from 'child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { runFirstTimeSetup } from './first-run.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 18789;

// Loading screen shown during startup before Gateway is ready
const LOADING_HTML = `data:text/html;charset=utf-8,${encodeURIComponent(`<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    display: flex; align-items: center; justify-content: center;
    flex-direction: column; height: 100vh;
    background: #0f1117; color: #e2e8f0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    gap: 20px; user-select: none; -webkit-app-region: drag;
  }
  .logo { font-size: 26px; font-weight: 700; letter-spacing: -0.5px; color: #fff; }
  .spinner {
    width: 32px; height: 32px;
    border: 3px solid rgba(255,255,255,0.1);
    border-top-color: #6366f1;
    border-radius: 50%;
    animation: spin 0.9s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  #status { font-size: 13px; color: #64748b; min-height: 18px; }
</style>
</head>
<body>
  <div class="logo">OpenClaw</div>
  <div class="spinner"></div>
  <div id="status">正在启动...</div>
</body>
</html>`)}`;

let gatewayProcess: ChildProcess | null = null;
let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

// 等待 Gateway 通过 HTTP 就绪
async function waitForGateway(maxMs = 15000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    // 检查子进程是否已意外退出
    if (gatewayProcess?.exitCode !== null) {
      throw new Error('Gateway process exited unexpectedly');
    }
    try {
      const res = await fetch(`http://localhost:${PORT}/`, { method: 'GET' });
      if (res.ok || res.status === 404) {
        console.log('[Electron] Gateway is ready');
        return;
      }
    } catch {
      // Still connecting...
    }
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error(`Gateway did not start in ${maxMs}ms`);
}

// Update the status text shown in the loading screen
function updateLoadingStatus(message: string): void {
  if (win && !win.isDestroyed()) {
    void win.webContents.executeJavaScript(
      `var el = document.getElementById('status'); if (el) el.textContent = ${JSON.stringify(message)};`
    ).catch(() => {});
  }
}

// Helper: find Node executable in system
function findNodePath(): string {
  const candidates = [
    '/usr/local/bin/node',
    '/opt/homebrew/bin/node',
    '/opt/homebrew/opt/node@22/bin/node',
  ];

  // Try NVM: ~/.nvm/versions/node/*/bin/node (latest first)
  try {
    const nvmBase = path.join(os.homedir(), '.nvm', 'versions', 'node');
    if (fs.existsSync(nvmBase)) {
      const versions = fs.readdirSync(nvmBase).toSorted().toReversed();
      for (const version of versions) {
        const nvmNode = path.join(nvmBase, version, 'bin', 'node');
        if (fs.existsSync(nvmNode)) {
          return nvmNode;
        }
      }
    }
  } catch {
    // ignore
  }

  // Try Volta
  const voltaNode = path.join(os.homedir(), '.volta', 'bin', 'node');
  if (fs.existsSync(voltaNode)) {
    return voltaNode;
  }

  for (const cand of candidates) {
    if (fs.existsSync(cand)) {
      return cand;
    }
  }

  // fallback
  return process.execPath;
}

// Helper: find pnpm executable
function findPnpmPath(): string {
  const candidates = [
    '/usr/local/bin/pnpm',
    '/opt/homebrew/bin/pnpm',
  ];

  // Try NVM
  try {
    const nvmBase = path.join(os.homedir(), '.nvm', 'versions', 'node');
    if (fs.existsSync(nvmBase)) {
      const versions = fs.readdirSync(nvmBase).toSorted().toReversed();
      for (const version of versions) {
        const nvmPnpm = path.join(nvmBase, version, 'bin', 'pnpm');
        if (fs.existsSync(nvmPnpm)) {
          return nvmPnpm;
        }
      }
    }
  } catch {
    // ignore
  }

  // Try Volta
  const voltaPnpm = path.join(os.homedir(), '.volta', 'bin', 'pnpm');
  if (fs.existsSync(voltaPnpm)) {
    return voltaPnpm;
  }

  for (const cand of candidates) {
    if (fs.existsSync(cand)) {
      return cand;
    }
  }

  // fallback: rely on PATH
  return 'pnpm';
}

async function startApp() {
  if (isQuitting) {
    console.log('[Electron] App is quitting, skipping startApp');
    return;
  }

  // Show loading window immediately so user knows the app is starting
  const preloadPath = path.join(__dirname, 'preload.js');
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    backgroundColor: '#0f1117',
    webPreferences: { preload: preloadPath, contextIsolation: true },
  });
  await win.loadURL(LOADING_HTML);
  win.show();

  try {
    updateLoadingStatus('检测应用配置...');
    const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');
    const isFirstRun = !fs.existsSync(configPath);

    if (isFirstRun) {
      console.log('[Electron] First run detected, performing setup...');
      updateLoadingStatus('初始化配置，请稍候...');

      if (!app.isPackaged) {
        // In dev mode: run full onboarding
        const defaultsPath = path.join(app.getAppPath(), 'config', 'first-run-defaults.json');
        if (!fs.existsSync(defaultsPath)) {
          console.log('[Electron] first-run-defaults.json not found, skipping first-run setup');
          console.log('[Electron] Copy config/first-run-defaults.json.example to config/first-run-defaults.json and fill in your API key');
        } else {
          const defaults = JSON.parse(fs.readFileSync(defaultsPath, 'utf-8'));

          const nodePath = findNodePath();
          const pnpmPath = findPnpmPath();
          const appPath = app.getAppPath();
          const monorepoRoot = path.resolve(appPath, '../../../../../../../..');

          console.log('[Electron] Dev mode: running full onboarding');
          console.log('[Electron] Using node from:', nodePath);
          console.log('[Electron] Using pnpm from:', pnpmPath);

          await runFirstTimeSetup({
            nodePath,
            clawCommand: [pnpmPath, 'openclaw'],
            resourcesPath: process.resourcesPath,
            monorepoRoot,
            defaults,
          });

          console.log('[Electron] First-time setup completed');
        }
      } else {
        // Packaged mode: run real onboarding using dist/entry.js
        console.log('[Electron] Packaged mode: running onboarding via dist/entry.js');
        const nodePath = findNodePath();
        const entryScript = path.join(process.resourcesPath, 'dist', 'entry.js');
        const defaultsPath = path.join(process.resourcesPath, 'config', 'first-run-defaults.json');
        const defaults = JSON.parse(fs.readFileSync(defaultsPath, 'utf-8'));

        await runFirstTimeSetup({
          nodePath,
          clawCommand: [entryScript],
          resourcesPath: process.resourcesPath,
          monorepoRoot: process.resourcesPath,
          defaults,
        });

        console.log('[Electron] First-time setup completed');
      }
    }

    const gatewayToken = crypto.randomBytes(24).toString('hex');
    console.log('[Electron] Generated gateway token');

    console.log('[Electron] Starting Gateway subprocess...');
    updateLoadingStatus('启动后台服务...');

    const nodePath = findNodePath();
    const nodeBinDir = path.dirname(nodePath);
    const augmentedPath = [nodeBinDir, '/usr/local/bin', '/opt/homebrew/bin', process.env.PATH || '']
      .filter(Boolean)
      .join(':');

    console.log('[Electron] Using node from:', nodePath);

    let gatewayArgs: string[];
    let cwdDir: string;

    if (app.isPackaged) {
      // Packaged mode: run dist/entry.js directly; node_modules are at Resources/node_modules/
      const entryScript = path.join(process.resourcesPath, 'dist', 'entry.js');
      gatewayArgs = [entryScript, 'gateway', 'run', '--port', String(PORT), '--bind', 'loopback', '--allow-unconfigured', '--token', gatewayToken];
      cwdDir = process.resourcesPath;
      console.log('[Electron] Packaged mode: running dist/entry.js directly');
      console.log('[Electron] Entry script:', entryScript);
    } else {
      // Dev mode: use pnpm openclaw from monorepo root
      const pnpmPath = findPnpmPath();
      const appPath = app.getAppPath();
      const monorepoRoot = path.resolve(appPath, '../../../../../../../..');
      gatewayArgs = [pnpmPath, 'openclaw', 'gateway', 'run', '--port', String(PORT), '--bind', 'loopback', '--allow-unconfigured', '--token', gatewayToken];
      cwdDir = monorepoRoot;
      console.log('[Electron] Dev mode: using pnpm from:', pnpmPath);
      console.log('[Electron] Monorepo root:', monorepoRoot);
    }

    console.log('[Electron] Augmented PATH:', augmentedPath);

    gatewayProcess = spawn(
      nodePath,
      gatewayArgs,
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: cwdDir,
        env: { ...process.env, PATH: augmentedPath },
        detached: true,
      }
    );

    if (!gatewayProcess.pid) {
      throw new Error('Failed to spawn Gateway process');
    }

    console.log(`[Electron] Gateway process spawned with PID ${gatewayProcess.pid}`);

    gatewayProcess.stdout?.on('data', (data) => {
      console.log('[Gateway]', data.toString().trim());
    });
    gatewayProcess.stderr?.on('data', (data) => {
      console.error('[Gateway]', data.toString().trim());
    });

    gatewayProcess.on('exit', (code, signal) => {
      console.log(`[Electron] Gateway process exited with code ${code} signal ${signal}`);
    });

    updateLoadingStatus('等待服务就绪...');
    await waitForGateway();
    console.log('[Electron] Gateway started successfully');

    console.log('[Electron] Loading UI from HTTP');
    await win.loadURL(`http://localhost:${PORT}/#token=${gatewayToken}`);

    if (process.env.NODE_ENV === 'development') {
      win.webContents.openDevTools();
    }

    win.on('close', (e) => {
      if (!isQuitting) {
        e.preventDefault();
        win?.hide();
      }
    });

    const icon = nativeImage.createEmpty();
    tray = new Tray(icon);
    tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: '打开 OpenClaw',
          click: () => {
            win?.show();
            win?.focus();
          },
        },
        { type: 'separator' },
        {
          label: '退出',
          click: () => {
            app.quit();
          },
        },
      ])
    );

    tray.on('click', () => {
      if (win?.isVisible()) {
        win?.hide();
      } else {
        win?.show();
        win?.focus();
      }
    });

    console.log('[Electron] App started successfully');
  } catch (err) {
    console.error('[Electron] Failed to start app:', err);
    dialog.showErrorBox('OpenClaw 启动失败', `启动错误: ${String(err)}`);
    app.quit();
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    console.log('[Electron] Second instance attempted, focusing existing window');
    if (win) {
      if (win.isMinimized()) {
        win.restore();
      }
      win.show();
      win.focus();
    }
  });

  app.on('ready', startApp);

  app.on('before-quit', (e) => {
    console.log('[Electron] Before quit: terminating Gateway process');

    if (isQuitting && gatewayProcess === null) {
      console.log('[Electron] Already quitting, allowing quit');
      return;
    }

    isQuitting = true;

    if (gatewayProcess && !gatewayProcess.killed) {
      e.preventDefault();

      const gp = gatewayProcess;
      const pgid = gp.pid!;
      gatewayProcess = null;

      const finish = () => {
        console.log('[Electron] Gateway cleanup complete, quitting app');
        app.quit();
      };

      const killTimer = setTimeout(() => {
        console.log('[Electron] SIGTERM timeout, forcing SIGKILL to process group');
        try {
          process.kill(-pgid, 'SIGKILL');
        } catch (err) {
          console.error('[Electron] Error sending SIGKILL:', err);
        }
        finish();
      }, 2000);

      gp.once('exit', () => {
        clearTimeout(killTimer);
        console.log('[Electron] Gateway process exited cleanly');
        finish();
      });

      try {
        process.kill(-pgid, 'SIGTERM');
      } catch (err) {
        console.error('[Electron] Error sending SIGTERM:', err);
        finish();
      }
    }
  });

  app.on('window-all-closed', () => {
    app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && !isQuitting) {
      void startApp();
    } else {
      win?.show();
      win?.focus();
    }
  });
}
