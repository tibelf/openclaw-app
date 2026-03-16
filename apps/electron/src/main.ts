import { app, BrowserWindow, Tray, Menu, nativeImage, dialog } from 'electron';
import path from 'path';
import os from 'node:os';
import { fileURLToPath } from 'url';
import { spawn, spawnSync, type ChildProcess } from 'child_process';
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
let gatewayToken = '';
let gatewayRestartCount = 0;
let gatewayStartTime = 0;
const MAX_GATEWAY_RESTARTS = 5;
let gatewayLogLines: string[] = [];  // 滚动缓冲，最多保留最近 50 行
let gatewayLogStream: fs.WriteStream | null = null;

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

async function runConfigRepair(nodePath: string, args: string[]): Promise<void> {
  return new Promise((resolve) => {
    const proc = spawn(nodePath, [...args, 'doctor', '--fix', '--non-interactive'], {
      stdio: 'pipe',
      env: { ...process.env },
    });
    const timer = setTimeout(() => {
      proc.kill();
      resolve();
    }, 10000);
    proc.on('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    proc.on('error', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function killProcessOnPort(port: number): Promise<void> {
  try {
    const result = spawnSync('lsof', ['-ti', `:${port}`], { encoding: 'utf8' });
    const pids = (result.stdout ?? '').trim().split('\n').filter(Boolean);
    for (const pid of pids) {
      try {
        process.kill(parseInt(pid), 'SIGKILL');
        console.log(`[Electron] Killed competing process ${pid} on port ${port}`);
      } catch {
        // 进程可能已退出，忽略
      }
    }
    if (pids.length > 0) {
      // 等待端口释放
      await new Promise(r => setTimeout(r, 500));
    }
  } catch {
    // lsof 不可用或无匹配进程，忽略
  }
}

function spawnGateway(token: string): void {
  const nodePath = findNodePath();
  const nodeBinDir = path.dirname(nodePath);
  const augmentedPath = [nodeBinDir, '/usr/local/bin', '/opt/homebrew/bin', process.env.PATH || '']
    .filter(Boolean)
    .join(':');

  let gatewayArgs: string[];
  let cwdDir: string;

  if (app.isPackaged) {
    const entryScript = path.join(process.resourcesPath, 'dist', 'entry.js');
    gatewayArgs = [entryScript, 'gateway', 'run', '--port', String(PORT), '--bind', 'loopback', '--allow-unconfigured', '--token', token];
    cwdDir = process.resourcesPath;
    console.log('[Electron] Packaged mode: running dist/entry.js directly');
    console.log('[Electron] Entry script:', path.join(process.resourcesPath, 'dist', 'entry.js'));
  } else {
    const pnpmPath = findPnpmPath();
    const appPath = app.getAppPath();
    const monorepoRoot = path.resolve(appPath, '../../../../../../../..');
    gatewayArgs = [pnpmPath, 'openclaw', 'gateway', 'run', '--port', String(PORT), '--bind', 'loopback', '--allow-unconfigured', '--token', token];
    cwdDir = monorepoRoot;
    console.log('[Electron] Dev mode: using pnpm from:', pnpmPath);
    console.log('[Electron] Monorepo root:', monorepoRoot);
  }

  console.log('[Electron] Using node from:', nodePath);
  console.log('[Electron] Augmented PATH:', augmentedPath);

  gatewayProcess = spawn(
    nodePath,
    gatewayArgs,
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: cwdDir,
      env: { ...process.env, PATH: augmentedPath, OPENCLAW_NO_RESPAWN: '1' },
      detached: true,
    }
  );

  if (!gatewayProcess.pid) {
    throw new Error('Failed to spawn Gateway process');
  }

  gatewayStartTime = Date.now();
  console.log(`[Electron] Gateway process spawned with PID ${gatewayProcess.pid}`);

  const appendGatewayLog = (line: string) => {
    console.log('[Gateway]', line);
    gatewayLogLines.push(line);
    if (gatewayLogLines.length > 50) {gatewayLogLines.shift();}
    gatewayLogStream?.write(line + '\n');
  };

  gatewayProcess.stdout?.on('data', (data) => {
    for (const line of data.toString().split('\n').filter(Boolean)) {appendGatewayLog(line);}
  });
  gatewayProcess.stderr?.on('data', (data) => {
    for (const line of data.toString().split('\n').filter(Boolean)) {appendGatewayLog(line);}
  });

  gatewayProcess.on('exit', (code, signal) => {
    console.log(`[Electron] Gateway process exited with code ${code} signal ${signal}`);
    if (!isQuitting) {
      // 如果稳定运行超过 30 秒，说明是外部原因导致退出，重置计数器
      const uptime = Date.now() - gatewayStartTime;
      if (uptime > 30000) {
        console.log(`[Electron] Gateway ran for ${uptime}ms, resetting restart counter`);
        gatewayRestartCount = 0;
      }
      scheduleGatewayRestart();
    }
  });
}

function scheduleGatewayRestart(): void {
  if (gatewayRestartCount >= MAX_GATEWAY_RESTARTS) {
    dialog.showErrorBox('OpenClaw 后台服务异常', '后台服务多次崩溃，请重启应用');
    return;
  }
  gatewayRestartCount++;
  const delay = Math.min(1000 * gatewayRestartCount, 5000);
  console.log(`[Electron] Gateway exited, restarting in ${delay}ms (attempt ${gatewayRestartCount})`);
  setTimeout(async () => {
    if (isQuitting) {return;}
    // 先 kill 占用端口的竞争进程（如 macOS 菜单栏 App 的 gateway）
    await killProcessOnPort(PORT);
    spawnGateway(gatewayToken);
    try {
      await waitForGateway();
      // 验证是否是我们的 gateway 仍在运行（端口竞争时我们的进程会退出）
      if (gatewayProcess?.exitCode !== null) {
        throw new Error('Our gateway exited after start, possible port conflict');
      }
      console.log('[Electron] Gateway restarted successfully, reloading UI');
      gatewayRestartCount = 0;
      if (win && !win.isDestroyed()) {
        await win.loadURL(`http://localhost:${PORT}/#token=${gatewayToken}`);
      }
    } catch (err) {
      console.error('[Electron] Gateway restart verification failed:', err);
      // waitForGateway 失败说明 gateway 又挂了，exit handler 会再次触发重启
    }
  }, delay);
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
    const nodePath = findNodePath();
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

    // 启动 Gateway 前修复 config（清理无效 key，防止 Gateway 解析失败）
    updateLoadingStatus('检查配置完整性...');
    console.log('[Electron] Running config repair...');
    if (app.isPackaged) {
      const entryScript = path.join(process.resourcesPath, 'dist', 'entry.js');
      await runConfigRepair(nodePath, [entryScript]);
    } else {
      const pnpmPath = findPnpmPath();
      await runConfigRepair(nodePath, [pnpmPath, 'openclaw']);
    }
    console.log('[Electron] Config repair done');

    gatewayToken = crypto.randomBytes(24).toString('hex');
    console.log('[Electron] Generated gateway token');

    console.log('[Electron] Starting Gateway subprocess...');
    updateLoadingStatus('启动后台服务...');

    // 初始化 gateway 日志文件
    const logDir = app.getPath('logs');
    fs.mkdirSync(logDir, { recursive: true });
    const logPath = path.join(logDir, 'gateway.log');
    gatewayLogLines = [];
    gatewayLogStream?.end();
    gatewayLogStream = fs.createWriteStream(logPath, { flags: 'a' });
    gatewayLogStream.write(`\n=== Gateway started at ${new Date().toISOString()} ===\n`);

    // 清理可能占用端口的竞争进程（如 macOS 菜单栏 App 的 gateway）
    await killProcessOnPort(PORT);
    spawnGateway(gatewayToken);

    updateLoadingStatus('等待服务就绪...');
    await waitForGateway();
    console.log('[Electron] Gateway started successfully');
    gatewayRestartCount = 0; // 成功启动后重置崩溃计数

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
    const logPath = path.join(app.getPath('logs'), 'gateway.log');
    const lastLines = gatewayLogLines.slice(-20).join('\n');
    const detail = lastLines
      ? `Gateway 最后输出:\n${lastLines}\n\n完整日志: ${logPath}`
      : `完整日志: ${logPath}`;
    dialog.showMessageBoxSync({
      type: 'error',
      title: 'OpenClaw 启动失败',
      message: String(err),
      detail,
      buttons: ['确定'],
    });
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
        // openclaw-gateway 可能以独立 daemon 方式运行（独立进程组），额外 pkill 确保清理
        try {
          spawnSync('pkill', ['-x', 'openclaw-gateway'], { stdio: 'ignore' });
        } catch {
          // 忽略（进程不存在时 pkill 返回非零，属正常）
        }
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
