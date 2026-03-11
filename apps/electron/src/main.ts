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

  try {
    const configPath = path.join(app.getPath('userData'), 'openclaw.json');
    const isFirstRun = !fs.existsSync(configPath);

    if (isFirstRun) {
      console.log('[Electron] First run detected, performing setup...');

      if (!app.isPackaged) {
        // In dev mode: run full onboarding
        const defaultsPath = path.join(app.getAppPath(), 'config', 'first-run-defaults.json');
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
          pnpmPath,
          resourcesPath: process.resourcesPath,
          monorepoRoot,
          defaults,
        });

        console.log('[Electron] First-time setup completed');
      } else {
        // In packaged mode: create minimal configuration
        console.log('[Electron] Packaged mode: creating minimal configuration');
        const configDir = path.dirname(configPath);
        fs.mkdirSync(configDir, { recursive: true });

        // Load first-run defaults
        const defaultsPath = path.join(process.resourcesPath, 'config', 'first-run-defaults.json');
        const defaults = JSON.parse(fs.readFileSync(defaultsPath, 'utf-8'));

        const minimalConfig = {
          ai: {
            provider: defaults.ai.provider || 'custom',
            model: defaults.ai.model || 'gpt-4',
            baseUrl: defaults.ai.baseUrl,
            apiKey: process.env.OPENCLAW_BUNDLED_API_KEY || defaults.ai.apiKey,
          },
          workspace: {
            dir: defaults.workspace.dir || path.join(os.homedir(), 'openclaw-workspace'),
          },
        };

        fs.writeFileSync(configPath, JSON.stringify(minimalConfig, null, 2));
        console.log('[Electron] Minimal configuration created');
      }
    }

    const gatewayToken = crypto.randomBytes(24).toString('hex');
    console.log('[Electron] Generated gateway token');

    console.log('[Electron] Starting Gateway subprocess...');

    const nodePath = findNodePath();
    const pnpmPath = findPnpmPath();
    const appPath = app.getAppPath();
    const monorepoRoot = app.isPackaged
      ? process.resourcesPath
      : path.resolve(appPath, '../../../../../../../..');

    const nodeBinDir = path.dirname(nodePath);
    const augmentedPath = [nodeBinDir, '/usr/local/bin', '/opt/homebrew/bin', process.env.PATH || '']
      .filter(Boolean)
      .join(':');

    console.log('[Electron] Using node from:', nodePath);
    console.log('[Electron] Using pnpm from:', pnpmPath);
    console.log('[Electron] Monorepo root:', monorepoRoot);
    console.log('[Electron] Augmented PATH:', augmentedPath);

    gatewayProcess = spawn(
      nodePath,
      [pnpmPath, 'openclaw', 'gateway', 'run', '--port', String(PORT), '--bind', 'loopback', '--allow-unconfigured', '--token', gatewayToken],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: monorepoRoot,
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

    await waitForGateway();
    console.log('[Electron] Gateway started successfully');

    const preloadPath = path.join(__dirname, 'preload.js');
    console.log('[Electron] Loading preload from:', preloadPath);

    win = new BrowserWindow({
      width: 1280,
      height: 800,
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
      },
    });

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
