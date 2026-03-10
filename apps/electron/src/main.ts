import { app, BrowserWindow, Tray, Menu, nativeImage } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn, type ChildProcess } from 'child_process';
import crypto from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 18789;
let gatewayProcess: ChildProcess | null = null;
let win: BrowserWindow | null = null;
let tray: Tray | null = null;

// 等待 Gateway 通过 HTTP 就绪
async function waitForGateway(maxMs = 15000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
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
  try {
    // 生成 Gateway token
    const gatewayToken = crypto.randomBytes(24).toString('hex');
    console.log('[Electron] Generated gateway token');

    // 1. 启动 Gateway 为 subprocess
    console.log('[Electron] Starting Gateway subprocess...');

    // 构造 pnpm openclaw 命令
    // 在项目根目录运行：pnpm openclaw gateway run --port 18789 --bind loopback
    const appPath = app.getAppPath();
    const monorepoRoot = path.resolve(appPath, '../../../../../../../..');

    // 尝试找到 pnpm 可执行文件
    const possiblePnpmPaths = [
      '/Users/tibelf/.nvm/versions/node/v22.12.0/bin/pnpm',
      path.resolve(monorepoRoot, 'node_modules/.bin/pnpm'),
      path.resolve(monorepoRoot, 'node_modules/.pnpm/.bin/pnpm'),
      'pnpm',
    ];

    let pnpmPath = possiblePnpmPaths[0]; // 默认使用 NVM pnpm
    const env = { ...process.env, OPENCLAW_GATEWAY_TOKEN: gatewayToken };

    console.log('[Electron] Running from:', monorepoRoot);

    gatewayProcess = spawn(pnpmPath, [
      'openclaw',
      'gateway', 'run',
      '--port', String(PORT),
      '--bind', 'loopback',
      '--allow-unconfigured',
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: monorepoRoot,
      env,
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

    // 5. 窗口关闭时隐藏到托盘而不是退出
    win.on('close', (e) => {
      e.preventDefault();
      win?.hide();
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
    app.quit();
  }
}

app.on('ready', startApp);

app.on('before-quit', () => {
  console.log('[Electron] Terminating Gateway process');
  if (gatewayProcess && !gatewayProcess.killed) {
    gatewayProcess.kill('SIGTERM');
  }
});

app.on('window-all-closed', () => {
  // On macOS, keep app active in dock even after all windows close
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void startApp();
  }
});
