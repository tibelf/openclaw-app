import { app, BrowserWindow, Tray, Menu, nativeImage, dialog } from 'electron';
import path from 'path';
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

async function startApp() {
  // 如果应用正在退出，不要启动新窗口
  if (isQuitting) {
    console.log('[Electron] App is quitting, skipping startApp');
    return;
  }

  try {
    // Check for first-time run and perform setup if needed
    const configPath = path.join(app.getPath('userData'), 'openclaw.json');
    const isFirstRun = !fs.existsSync(configPath);

    if (isFirstRun) {
      console.log('[Electron] First run detected, performing setup...');
      const appPath = app.getAppPath();
      const monorepoRoot = path.resolve(appPath, '../../../../../../../..');

      // Load defaults
      const defaultsPath = app.isPackaged
        ? path.join(process.resourcesPath, 'config', 'first-run-defaults.json')
        : path.join(appPath, 'config', 'first-run-defaults.json');
      const defaults = JSON.parse(fs.readFileSync(defaultsPath, 'utf-8'));

      // Find node and pnpm paths (reuse existing logic)
      const possibleNodePaths = [
        '/Users/tibelf/.nvm/versions/node/v22.12.0/bin/node',
        process.execPath,
      ];
      const possiblePnpmPaths = [
        '/Users/tibelf/.nvm/versions/node/v22.12.0/bin/pnpm',
        path.resolve(monorepoRoot, 'node_modules/.bin/pnpm'),
        path.resolve(monorepoRoot, 'node_modules/.pnpm/.bin/pnpm'),
        'pnpm',
      ];

      let nodePath = possibleNodePaths[0];
      for (const candidate of possibleNodePaths) {
        if (fs.existsSync(candidate)) {
          nodePath = candidate;
          break;
        }
      }

      let pnpmPath = 'pnpm';
      for (const candidate of possiblePnpmPaths) {
        if (candidate !== 'pnpm' && fs.existsSync(candidate)) {
          pnpmPath = candidate;
          break;
        }
      }
      if (pnpmPath === 'pnpm') {
        pnpmPath = possiblePnpmPaths[possiblePnpmPaths.length - 1]!;
      }

      await runFirstTimeSetup({
        nodePath,
        pnpmPath,
        resourcesPath: path.join(appPath, '..', 'resources'),
        monorepoRoot,
        defaults,
      });

      console.log('[Electron] First-time setup completed');
    }

    // 生成 Gateway token
    const gatewayToken = crypto.randomBytes(24).toString('hex');
    console.log('[Electron] Generated gateway token');

    // 1. 启动 Gateway 为 subprocess
    console.log('[Electron] Starting Gateway subprocess...');

    // 构造 pnpm openclaw 命令
    // 在项目根目录运行：pnpm openclaw gateway run --port 18789 --bind loopback
    const appPath = app.getAppPath();
    const monorepoRoot = path.resolve(appPath, '../../../../../../../..');

    // 尝试找到 node 和 pnpm 可执行文件
    const possibleNodePaths = [
      '/Users/tibelf/.nvm/versions/node/v22.12.0/bin/node',
      process.execPath,
    ];
    const possiblePnpmPaths = [
      '/Users/tibelf/.nvm/versions/node/v22.12.0/bin/pnpm',
      path.resolve(monorepoRoot, 'node_modules/.bin/pnpm'),
      path.resolve(monorepoRoot, 'node_modules/.pnpm/.bin/pnpm'),
      'pnpm',
    ];

    // 找到第一个存在的 node 和 pnpm
    let nodePath = possibleNodePaths[0];
    for (const candidate of possibleNodePaths) {
      if (fs.existsSync(candidate)) {
        nodePath = candidate;
        break;
      }
    }

    let pnpmPath = 'pnpm'; // 最终 fallback
    for (const candidate of possiblePnpmPaths) {
      if (candidate !== 'pnpm' && fs.existsSync(candidate)) {
        pnpmPath = candidate;
        break;
      }
    }
    // 如果没找到，使用 PATH 中的 pnpm
    if (pnpmPath === 'pnpm') {
      pnpmPath = possiblePnpmPaths[possiblePnpmPaths.length - 1]!;
    }

    console.log('[Electron] Running from:', monorepoRoot);
    console.log('[Electron] Using node from:', nodePath);
    console.log('[Electron] Using pnpm from:', pnpmPath);

    // 从 node 路径推导 bin 目录，用于增强 PATH
    const nodeBinDir = path.dirname(nodePath);
    const augmentedPath = [
      nodeBinDir,
      '/usr/local/bin',
      '/opt/homebrew/bin',
      process.env.PATH || '',
    ]
      .filter(Boolean)
      .join(':');

    console.log('[Electron] Augmented PATH:', augmentedPath);

    // 使用 node 直接运行 pnpm（避免 pnpm 进程管理器的中间层）
    // 使用 detached: true 创建新的进程组，这样可以一次kill整个进程树
    gatewayProcess = spawn(nodePath, [pnpmPath, 'openclaw', 'gateway', 'run', '--port', String(PORT), '--bind', 'loopback', '--allow-unconfigured', '--token', gatewayToken], {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: monorepoRoot,
      env: { ...process.env, PATH: augmentedPath },
      detached: true,  // 创建新的进程组
    });

    if (!gatewayProcess.pid) {
      throw new Error('Failed to spawn Gateway process');
    }

    console.log(`[Electron] Gateway process spawned with PID ${gatewayProcess.pid}`);

    // 日志输出
    gatewayProcess.stdout?.on('data', (data) => {
      console.log('[Gateway]', data.toString().trim());
    });
    gatewayProcess.stderr?.on('data', (data) => {
      console.error('[Gateway]', data.toString().trim());
    });

    gatewayProcess.on('exit', (code, signal) => {
      console.log(`[Electron] Gateway process exited with code ${code} signal ${signal}`);
    });

    // 等待 Gateway HTTP 就绪
    await waitForGateway();
    console.log('[Electron] Gateway started successfully');

    // 2. 创建主窗口，注入 preload
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

    // 3. 加载 UI - 通过 Gateway HTTP server
    console.log('[Electron] Loading UI from HTTP');
    await win.loadURL(`http://localhost:${PORT}/#token=${gatewayToken}`);

    // 4. 开发模式打开 DevTools
    if (process.env.NODE_ENV === 'development') {
      win.webContents.openDevTools();
    }

    // 5. 窗口关闭时隐藏到托盘（退出过程中不阻止）
    win.on('close', (e) => {
      if (!isQuitting) {
        e.preventDefault();
        win?.hide();
      }
    });

    // 6. 托盘常驻
    const icon = nativeImage.createEmpty(); // TODO: 添加实际图标
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

// 单实例锁：防止多个应用实例同时运行
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  // 已有实例运行，直接退出（macOS 会自动激活已有实例）
  app.quit();
} else {
  // 当尝试启动第二个实例时激活第一个实例的窗口
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
      // 已经在清理过程中，allow quit
      console.log('[Electron] Already quitting, allowing quit');
      return;
    }

    isQuitting = true;

    if (gatewayProcess && !gatewayProcess.killed) {
      e.preventDefault(); // 阻止立即退出

      const gp = gatewayProcess;
      const pgid = gp.pid!; // 进程组 ID（因为 detached: true）
      gatewayProcess = null; // 置 null，防止第二次进入此分支

      const finish = () => {
        console.log('[Electron] Gateway cleanup complete, quitting app');
        app.quit();
      };

      // 尝试优雅关闭：SIGTERM 到进程组 + 2 秒超时后强制 SIGKILL
      const killTimer = setTimeout(() => {
        console.log('[Electron] SIGTERM timeout, forcing SIGKILL to process group');
        try {
          // 使用负 PID kill 整个进程组
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

      // Kill 整个进程组
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
