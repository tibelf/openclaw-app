import { app, BrowserWindow, Tray, Menu, nativeImage, dialog, ipcMain, protocol, shell, net } from 'electron';
import path from 'path';
import os from 'node:os';
import { fileURLToPath } from 'url';
import { spawn, spawnSync, type ChildProcess } from 'child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { runFirstTimeSetup } from './first-run.js';
import { getStoredAuth, saveAuth, clearAuth } from './auth-store.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 18789;

// Read New-API base URL from first-run-defaults.json at startup
function getNewApiBaseUrl(): string {
  try {
    const defaultsPath = app.isPackaged
      ? path.join(process.resourcesPath, 'config', 'first-run-defaults.json')
      : path.join(app.getAppPath(), 'config', 'first-run-defaults.json');
    if (fs.existsSync(defaultsPath)) {
      const defaults = JSON.parse(fs.readFileSync(defaultsPath, 'utf-8'));
      return ((defaults as { newapi?: { baseUrl?: string } }).newapi?.baseUrl ?? '').replace(/\/+$/, '');
    }
  } catch {
    // ignore
  }
  return '';
}

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
let authWin: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let isManualRetrying = false;
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
    const proc = spawn(nodePath, [...args, 'doctor', '--fix', '--yes'], {
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

function backupAndResetConfig(): boolean {
  const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');
  if (!fs.existsSync(configPath)) {return false;}
  const bakPath = configPath + '.bak';
  fs.copyFileSync(configPath, bakPath);
  fs.unlinkSync(configPath);
  console.log(`[Electron] Config backed up to ${bakPath} and removed`);
  return true;
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
    if (!isQuitting && !isManualRetrying) {
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

// Update the apiKey field for the first custom-* provider in openclaw.json
function updateGatewayApiKey(apiKey: string): void {
  const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
    const providers = (config?.models as Record<string, unknown>)?.providers as Record<string, Record<string, unknown>> | undefined;
    if (providers) {
      for (const key of Object.keys(providers)) {
        if (key.startsWith('custom-')) {
          providers[key].apiKey = apiKey;
          break;
        }
      }
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      console.log('[Electron] Updated Gateway apiKey for provider');
    }
  } catch (err) {
    console.error('[Electron] Failed to update Gateway apiKey:', err);
  }
}

// Only write if the stored value differs from what's already in openclaw.json
function updateGatewayApiKeyIfNeeded(apiKey: string): void {
  const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
    const providers = (config?.models as Record<string, unknown>)?.providers as Record<string, Record<string, unknown>> | undefined;
    if (providers) {
      for (const key of Object.keys(providers)) {
        if (key.startsWith('custom-') && providers[key].apiKey !== apiKey) {
          providers[key].apiKey = apiKey;
          fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
          console.log('[Electron] Synced Gateway apiKey from auth store');
          break;
        }
      }
    }
  } catch {
    // Config file not yet created (before first-run) — ignore
  }
}

// Execute full 5-step New-API auth flow in main process using net.fetch (no CORS restrictions)
async function doNewApiLogin(
  baseUrl: string, username: string, password: string
): Promise<{ accessToken: string; userId: number; username: string; apiKey: string }> {
  console.log('[doNewApiLogin] baseUrl:', baseUrl, 'username:', username);

  // Step 1: Login
  console.log('[doNewApiLogin] Step 1: POST /api/user/login');
  const loginResp = await net.fetch(`${baseUrl}/api/user/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  console.log('[doNewApiLogin] Step 1 status:', loginResp.status);
  const loginData = await loginResp.json() as { success: boolean; message?: string; data?: { id: number; username: string } };
  console.log('[doNewApiLogin] Step 1 data:', JSON.stringify(loginData));
  if (!loginResp.ok || !loginData.success) {throw new Error(loginData.message || '登录失败');}
  const userId = loginData.data!.id;
  const uname = loginData.data!.username;
  console.log('[doNewApiLogin] Step 1 OK → userId:', userId, 'username:', uname);

  // Extract session cookie from Step 1 response to pass explicitly in Step 2
  // net.fetch may not auto-carry cookies between requests in the same session
  const setCookieHeader = loginResp.headers.get('set-cookie') ?? '';
  const sessionCookie = setCookieHeader.split(/,(?=[^ ])/u).map(p => {
    const m = p.trim().match(/^([^=]+)=([^;]*)/);
    return m ? `${m[1].trim()}=${m[2].trim()}` : '';
  }).filter(Boolean).join('; ');
  console.log('[doNewApiLogin] session cookie extracted:', sessionCookie ? 'yes' : 'none');

  // Step 2: access_token — pass cookie explicitly
  console.log('[doNewApiLogin] Step 2: GET /api/user/token');
  const tokenResp = await net.fetch(`${baseUrl}/api/user/token`, {
    headers: { 'New-Api-User': String(userId), ...(sessionCookie ? { 'Cookie': sessionCookie } : {}) },
  });
  console.log('[doNewApiLogin] Step 2 status:', tokenResp.status);
  const tokenRespData = await tokenResp.json() as { data: string };
  console.log('[doNewApiLogin] Step 2 data:', JSON.stringify(tokenRespData));
  const accessToken = tokenRespData.data;
  if (!accessToken) {throw new Error('获取用户凭证失败');}
  console.log('[doNewApiLogin] Step 2 OK → accessToken prefix:', accessToken.substring(0, 8) + '...');

  // Step 3: AI token list
  const authHeaders = { 'Authorization': `Bearer ${accessToken}`, 'New-Api-User': String(userId) };
  console.log('[doNewApiLogin] Step 3: GET /api/token/');
  const tokensResp = await net.fetch(`${baseUrl}/api/token/`, { headers: authHeaders });
  console.log('[doNewApiLogin] Step 3 status:', tokensResp.status);
  const tokensData = await tokensResp.json() as { data?: { items?: Array<{ id: number }> } };
  console.log('[doNewApiLogin] Step 3 data (truncated):', JSON.stringify(tokensData).substring(0, 200));
  let items = tokensData.data?.items ?? [];
  console.log('[doNewApiLogin] Step 3 OK → items count:', items.length);

  // Step 4: create token if none exist
  if (items.length === 0) {
    console.log('[doNewApiLogin] Step 4: POST /api/token/ (create)');
    const createResp = await net.fetch(`${baseUrl}/api/token/`, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'default', remain_quota: 0, expired_time: -1, unlimited_quota: true, model_limits_enabled: false }),
    });
    console.log('[doNewApiLogin] Step 4 create status:', createResp.status);
    console.log('[doNewApiLogin] Step 4 create data:', JSON.stringify(await createResp.json()));
    const newListResp = await net.fetch(`${baseUrl}/api/token/`, { headers: authHeaders });
    console.log('[doNewApiLogin] Step 4 list status:', newListResp.status);
    const newListData = await newListResp.json() as { data?: { items?: Array<{ id: number }> } };
    items = newListData.data?.items ?? [];
    console.log('[doNewApiLogin] Step 4 OK → items count after create:', items.length);
  } else {
    console.log('[doNewApiLogin] Step 4: skipped (tokens exist)');
  }
  if (items.length === 0) {throw new Error('无法获取 AI 令牌');}

  // Step 5: get full AI key
  console.log('[doNewApiLogin] Step 5: POST /api/token/' + items[0].id + '/key');
  const keyResp = await net.fetch(`${baseUrl}/api/token/${items[0].id}/key`, { method: 'POST', headers: authHeaders });
  console.log('[doNewApiLogin] Step 5 status:', keyResp.status);
  const keyData = await keyResp.json() as { data?: { key: string } };
  console.log('[doNewApiLogin] Step 5 data:', JSON.stringify(keyData));
  if (!keyData.data?.key) {throw new Error('无法获取 AI 密钥');}
  const apiKey = 'sk-' + keyData.data.key;
  console.log('[doNewApiLogin] Step 5 OK → apiKey prefix:', apiKey.substring(0, 12) + '...');

  console.log('[doNewApiLogin] ALL STEPS PASSED');
  return { accessToken, userId, username: uname, apiKey };
}

// Show auth window and wait for user to login
function showAuthWindow(): Promise<void> {
  return new Promise((resolve, reject) => {
    const preloadPath = path.join(__dirname, 'preload-auth.cjs');
    authWin = new BrowserWindow({
      width: 440,
      height: 580,
      resizable: false,
      show: false,
      backgroundColor: '#0f1117',
      title: 'OpenClaw — 登录',
      webPreferences: { preload: preloadPath, contextIsolation: true },
    });

    const authHtmlPath = path.join(app.getAppPath(), 'ui', 'auth.html');
    void authWin.loadFile(authHtmlPath);
    authWin.once('ready-to-show', () => {
      authWin?.show();
    });

    let resolved = false;

    // Override the save-token handler temporarily to capture the token
    // (the permanent handler is set in registerIpcHandlers, called before this)
    // We listen on 'auth:token-saved' event emitted by the permanent handler
    const onTokenSaved = () => {
      if (resolved) { return; }
      resolved = true;
      app.removeListener('auth:token-saved' as never, onTokenSaved as never);
      if (authWin && !authWin.isDestroyed()) {
        authWin.close();
        authWin = null;
      }
      resolve();
    };

    app.on('auth:token-saved' as never, onTokenSaved as never);

    authWin.on('closed', () => {
      authWin = null;
      app.removeListener('auth:token-saved' as never, onTokenSaved as never);
      if (!resolved) {
        reject(new Error('Auth window closed without login'));
      }
    });
  });
}

function registerIpcHandlers(): void {
  const baseUrl = getNewApiBaseUrl();

  ipcMain.handle('auth:get-base-url', () => baseUrl);

  ipcMain.handle('auth:do-login', async (_e, username: string, password: string) => {
    try {
      const authData = await doNewApiLogin(baseUrl, username, password);
      saveAuth(authData);
      updateGatewayApiKey(authData.apiKey);
      app.emit('auth:token-saved');
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('auth:save-token', (_e, accessToken: string, userId: number, username: string, apiKey: string) => {
    saveAuth({ accessToken, userId, username, apiKey });
    updateGatewayApiKey(apiKey);
    app.emit('auth:token-saved');
  });

  ipcMain.handle('account:info', () => {
    const auth = getStoredAuth();
    return { accessToken: auth.accessToken ?? '', userId: auth.userId ?? 0, baseUrl };
  });

  ipcMain.handle('open-external', (_e, url: string) => {
    void shell.openExternal(url);
  });

  ipcMain.handle('auth:logout', () => {
    clearAuth();
    app.relaunch();
    app.quit();
  });

  ipcMain.handle('account:open-window', () => {
    const preloadPath = path.join(__dirname, 'preload-auth.cjs');
    const accountHtmlPath = path.join(app.getAppPath(), 'ui', 'account.html');
    const accountWin = new BrowserWindow({
      width: 480,
      height: 700,
      backgroundColor: '#f5f7fa',
      title: 'OpenClaw — 账户',
      webPreferences: { preload: preloadPath, contextIsolation: true },
    });
    void accountWin.loadFile(accountHtmlPath);
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

  // Auth check: if New-API is configured, ensure user has logged in and apiKey is synced
  const newApiBaseUrl = getNewApiBaseUrl();
  if (newApiBaseUrl) {
    const storedAuth = getStoredAuth();
    if (storedAuth.apiKey) {
      // Cached credentials: ensure openclaw.json provider apiKey matches stored value
      updateGatewayApiKeyIfNeeded(storedAuth.apiKey);
      console.log('[Electron] Using cached auth, apiKey synced to Gateway config');
    } else {
      console.log('[Electron] No auth token found, showing auth window');
      try {
        await showAuthWindow();
        console.log('[Electron] Auth completed, continuing startup');
      } catch (err) {
        console.error('[Electron] Auth window closed without login:', err);
        app.quit();
        return;
      }
    }
  }

  // Show loading window immediately so user knows the app is starting
  const preloadPath = path.join(__dirname, 'preload.cjs');
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

    // Sync user apiKey to Gateway config after first-run setup.
    // On first launch, updateGatewayApiKey() in the login handler fails because
    // openclaw.json doesn't exist yet. Now that setup has created it, write the key.
    const postSetupAuth = getStoredAuth();
    if (postSetupAuth.apiKey) {
      updateGatewayApiKey(postSetupAuth.apiKey);
      console.log('[Electron] Synced user apiKey to Gateway config');
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
    try {
      await waitForGateway();
    } catch (gatewayErr) {
      // 检查 gateway 日志中是否含 Config invalid（可能由无效插件引用等导致）
      const hasConfigError = gatewayLogLines.some(
        line => line.includes('Invalid config') || line.includes('Config invalid')
      );
      if (!hasConfigError) {throw gatewayErr;}

      console.log('[Electron] Config invalid detected in gateway logs, attempting config backup + reset + retry');
      isManualRetrying = true;
      try {
        // 终止已退出/卡住的 gateway 进程
        if (gatewayProcess && !gatewayProcess.killed) {
          gatewayProcess.kill('SIGKILL');
          gatewayProcess = null;
        }

        updateLoadingStatus('配置异常，正在重置...');
        backupAndResetConfig();

        // 重新运行 first-run setup 以重建干净的 config；失败时记录日志但不中断，gateway 有 --allow-unconfigured 仍可启动
        updateLoadingStatus('重新初始化配置...');
        try {
          if (!app.isPackaged) {
            const defaultsPath = path.join(app.getAppPath(), 'config', 'first-run-defaults.json');
            if (fs.existsSync(defaultsPath)) {
              const defaults = JSON.parse(fs.readFileSync(defaultsPath, 'utf-8'));
              const pnpmPath = findPnpmPath();
              const appPath = app.getAppPath();
              const monorepoRoot = path.resolve(appPath, '../../../../../../../..');
              await runFirstTimeSetup({ nodePath, clawCommand: [pnpmPath, 'openclaw'], resourcesPath: process.resourcesPath, monorepoRoot, defaults });
            }
          } else {
            const entryScript = path.join(process.resourcesPath, 'dist', 'entry.js');
            const defaultsPath = path.join(process.resourcesPath, 'config', 'first-run-defaults.json');
            const defaults = JSON.parse(fs.readFileSync(defaultsPath, 'utf-8'));
            await runFirstTimeSetup({ nodePath, clawCommand: [entryScript], resourcesPath: process.resourcesPath, monorepoRoot: process.resourcesPath, defaults });
          }
        } catch (setupErr) {
          console.warn('[Electron] First-run setup failed after config reset, proceeding without it:', setupErr);
        }

        // 重置日志缓冲区，重新启动 gateway
        gatewayLogLines = [];
        gatewayLogStream?.write(`\n=== Gateway restarted after config reset at ${new Date().toISOString()} ===\n`);
        await killProcessOnPort(PORT);
        spawnGateway(gatewayToken);
        updateLoadingStatus('等待服务就绪（重试）...');
        await waitForGateway();
        console.log('[Electron] Gateway started successfully after config reset');
      } finally {
        isManualRetrying = false;
      }
    }
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

  // Register app:// protocol so local HTML pages can be served from app package
  void app.whenReady().then(() => {
    protocol.registerFileProtocol('app', (request, callback) => {
      const urlPath = decodeURIComponent(request.url.replace('app://', '').split('?')[0]);
      const filePath = path.join(app.getAppPath(), 'ui', `${urlPath}.html`);
      callback({ path: filePath });
    });
  });

  // Register IPC handlers once
  registerIpcHandlers();

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
