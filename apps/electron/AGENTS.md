# Electron Desktop App — 技术设计文档

本文档为 AI Agent 提供 Electron 桌面应用的完整技术指南，包含架构设计、关键文件、依赖关系和迭代规范。

## 概述

**目的**：将 OpenClaw Gateway + Web UI 打包为面向消费者的跨平台桌面应用，用户直接下载安装包即可使用，无需安装 Node.js 或运行 CLI 命令。

**版本**：2026.3.9
**平台**：macOS（arm64/x64）+ Windows
**核心设计原则**：最小化对上游代码的改动，完全复用 Gateway 和 Web UI 逻辑。

---

## 架构设计

### 整体拓扑

```
Electron Main Process
  └── spawn(pnpm openclaw gateway run --port 18789 --bind loopback --token <random-token>)
        └── Gateway 子进程（独立 Node.js 环境）
              ├── HTTP Server
              └── WebSocket Server

BrowserWindow
  └── loadURL('http://localhost:18789/#token=<random-token>')
        └── Web UI（Lit Web Components）
              ├── Preload 脚本注入配置
              └── WebSocket 连接 Gateway（token 验证）
```

### 为什么选择 Subprocess 方案？

2026.3.9 版本采用 **subprocess** 方式启动 Gateway（而非 in-process），原因如下：

1. **ESM/CJS 兼容性问题已解决**
   - `@mistralai/mistralai@1.10.0` 等依赖是 CJS 模块
   - 在 Electron ESM 环境中 `await import()` 会失败
   - Subprocess 拥有独立的 Node.js 运行时，完全隔离模块系统

2. **更好的进程隔离**
   - Gateway 崩溃不会导致 UI 进程崩溃
   - 可以独立重启 Gateway 而不需要重启整个应用
   - 打包体积更小（不需要 bundle 整个 node_modules）

3. **维护成本更低**
   - 上游代码更新无需调整打包逻辑
   - `pnpm openclaw gateway run` 命令在任何环境下都能工作
   - Git pull 后直接重新构建即可

---

## 关键文件清单

### Electron 应用源码

| 文件 | 用途 | 关键变量/函数 |
|------|------|---------------|
| `apps/electron/src/main.ts` | Electron Main Process：spawn Gateway + 创建窗口 + 托盘管理 | `PORT=18789`, `waitForGateway()`, `startApp()` |
| `apps/electron/src/preload.ts` | Preload 脚本：向 window 注入配置对象 | `window.__OPENCLAW_DESKTOP__` |
| `apps/electron/src/gateway.d.ts` | 类型声明，规避 TypeScript 模块解析 | （仅限类型，无运行时代码） |

### 打包配置

| 文件 | 用途 |
|------|------|
| `apps/electron/electron-builder.yml` | 打包流程：资源复制 + 代码签名 + 生成 DMG/ZIP/EXE |
| `apps/electron/scripts/copy-assets.mjs` | Prebuild 脚本：复制 `dist/` 和 `dist/control-ui/` 到资源路径 |
| `apps/electron/package.json` | Workspace 配置 + 脚本定义 |

### UI 相关

| 文件 | 用途 |
|------|------|
| `apps/electron/ui/index.html` | 自定义 HTML 入口（通常为空，直接加载 Gateway UI） |

---

## 上游改动清单（最小化）

Electron 应用为了支持隐藏高级功能（如 debug、nodes、instances tab），需要对上游代码做**最小化改动**：

| 文件 | 改动内容 | 行数 | 原因 |
|------|----------|------|------|
| `ui/src/ui/navigation.ts` | 添加 `getVisibleTabGroups()` 函数，支持通过 `window.__OPENCLAW_DESKTOP__.hiddenTabs` 过滤 Tab | ~10 行 | 隐藏高级 Tab，实现分级 UI |
| `ui/src/ui/app-render.ts` | 将 `TAB_GROUPS` 替换为 `getVisibleTabGroups()` 调用 | ~5 行 | 同上 |
| `src/infra/control-ui-assets.ts` | 添加 `process.resourcesPath` 作为 UI 资源搜索候选路径 | ~3 行 | 从 Electron asar 外资源加载 UI |

**总计改动 < 20 行代码**，影响范围极小，上游更新时冲突概率低。

---

## 核心实现细节

### 1. Subprocess 启动逻辑（`src/main.ts`）

```typescript
// 构造命令：pnpm openclaw gateway run --port 18789 --bind loopback --allow-unconfigured --token <token>
const gatewayToken = crypto.randomBytes(24).toString('hex');
const gatewayProcess = spawn(pnpmPath, [
  'openclaw',
  'gateway', 'run',
  '--port', String(PORT),
  '--bind', 'loopback',
  '--allow-unconfigured',  // 跳过 credential 校验
  '--token', gatewayToken, // 最高优先级，覆盖配置文件中的 token（防止 config-first token mismatch）
], {
  stdio: ['ignore', 'pipe', 'pipe'],  // 捕获 stdout/stderr
  cwd: monorepoRoot,                  // 项目根目录
  env: process.env,                   // 继承环境变量
});
```

**关键点**：
- `--bind loopback` 确保 Gateway 只在本地可访问（安全）
- `--allow-unconfigured` 跳过初始化检查，允许新用户启动应用
- `--token <token>` 传递随机生成的 token，优先级高于配置文件（`~/.openclaw/openclaw.json`），防止用户曾配置 token 时发生 mismatch
- Subprocess 有独立的 `stdio`，日志通过 pipe 转发到主进程

### 2. Gateway 就绪检测（`waitForGateway()`）

```typescript
async function waitForGateway(maxMs = 15000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const res = await fetch(`http://localhost:${PORT}/`);
      if (res.ok || res.status === 404) {
        console.log('[Electron] Gateway is ready');
        return;  // HTTP 服务就绪
      }
    } catch {
      // 继续轮询...
    }
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error(`Gateway did not start in ${maxMs}ms`);
}
```

**超时机制**：最多等待 15 秒，如果 Gateway 启动失败会抛出异常并让应用退出（防止永久卡顿）。

### 3. BrowserWindow 加载（`startApp()` 续）

```typescript
// 等待 Gateway 就绪后，加载 Web UI
await waitForGateway();

win = new BrowserWindow({
  width: 1200,
  height: 800,
  webPreferences: {
    preload: path.join(__dirname, 'preload.js'),  // 注入配置
    nodeIntegration: false,
    contextIsolation: true,
  },
});

// 加载本地 HTTP 服务的 Web UI，通过 URL hash 传递 token
win.loadURL(`http://localhost:${PORT}/#token=${gatewayToken}`);
```

**token 注入**：通过 URL hash `#token=<token>` 将随机 token 传递给 Web UI。Web UI 读取后在 WebSocket 握手时携带，与 Gateway 验证匹配。

### 4. Preload 脚本注入配置（`src/preload.ts`）

```typescript
// 仅在 Electron 环境中运行
if (process.contextIsolation) {
  window.__OPENCLAW_DESKTOP__ = {
    hiddenTabs: ['debug', 'nodes', 'instances'],  // 隐藏的高级功能
    brandName: 'OpenClaw',                        // 品牌名（可选）
    gatewayUrl: 'ws://localhost:18789',          // WebSocket 地址
  };
}
```

**安全性**：使用 `contextIsolation: true`，preload 脚本在独立沙箱中运行，无法访问主进程 API。

---

## 构建流程

```bash
# 完整构建流程
pnpm desktop:build

# 步骤分解：
1. pnpm build                    # 编译整个 monorepo（生成 dist/）
2. pnpm ui:build                 # 编译 Web UI（生成 dist/control-ui/）
3. npm run prebuild              # 复制资源（copy-assets.mjs）
4. tsc                           # 编译 Electron 源码
5. electron-builder              # 打包
   ├── 签名代码（如果有 signing 密钥）
   ├── 制作 macOS .app
   ├── 制作 .dmg 和 .zip
   └── 制作 Windows .exe
```

**输出**：
- macOS: `apps/electron/build/OpenClaw-2026.3.9-arm64.dmg` (~121 MB)
- macOS: `apps/electron/build/OpenClaw-2026.3.9-arm64-mac.zip` (~118 MB)
- Windows: `apps/electron/build/OpenClaw Setup 2026.3.9.exe`

---

## 依赖管理注意事项

### ⚠️ 重要：package.json 依赖规则

`apps/electron/package.json` 的 `dependencies` 必须为空 `{}`：

```json
{
  "dependencies": {},  // 空！不能有任何运行时依赖
  "devDependencies": {
    "electron": "^35.0.0",
    "electron-builder": "^25.0.0",
    "typescript": "^5.6.2"
  }
}
```

**原因**：
- pnpm 为 workspace 依赖创建 symlink（例如 `"openclaw": "workspace:*"` 会 symlink 到仓库根目录）
- electron-builder 跟随 symlink，扫描整个仓库文件
- 打包时会尝试签名 symlink 指向的所有文件（包括 `.env`、`CLAUDE.md` 等）
- 签名阶段这些文件不在 asar 中，导致 `ENOENT` 错误

**解决方案**：
- 不在 `dependencies` 中添加 `openclaw`
- 而是在启动时通过 `spawn(pnpmPath, [...])` 直接调用 `pnpm openclaw gateway run`
- pnpm monorepo 会自动解析命令，无需显式依赖

---

## 已知限制与改进机会

### 1. pnpm 路径硬编码

`src/main.ts` 第一项是硬编码路径：
```typescript
const possiblePnpmPaths = [
  '/Users/tibelf/.nvm/versions/node/v22.12.0/bin/pnpm',  // ← 硬编码！
  path.resolve(monorepoRoot, 'node_modules/.bin/pnpm'),
  'pnpm',
];
```

**问题**：不同机器上 NVM 路径不同，打包后可能失效。

**待改进**：
- 使用 `which pnpm` 或 npm script 的 `$npm_execpath` 动态查找
- 或改用 `process.execPath` + `node -e "require.resolve('pnpm/bin/pnpm.cjs')"`
- 或在打包时将 `pnpm` 复制到 app 资源中

### 2. Gateway 无重启机制

当前应用中没有提供"重启 Gateway"按钮。

**待改进**：
- 添加托盘菜单项："Restart Gateway"
- 实现：`gatewayProcess.kill()` + `startGateway()` 重启流程
- 或提供日志查看窗口（`tail -f /tmp/openclaw-gateway.log`）

### 3. Windows 构建验证

macOS 构建已测试并成功。Windows 部分需要在 Windows 机器上验证：
- `.exe` 安装包是否能正常运行
- Squirrel.Windows 自动更新流程

### 4. 自动更新

当前未集成 electron-updater。

**待实现**：
- 配置 Squirrel（Windows）或 Sparkle（macOS）
- 自动检查更新 + 后台下载 + 提示安装

---

## 待完成任务清单

- [ ] **应用图标** — 设计 OpenClaw logo，生成 ICNS（macOS）和 ICO（Windows）
- [ ] **pnpm 路径动态查找** — 改进 subprocess 启动的可靠性
- [ ] **Gateway 重启菜单** — 在托盘菜单添加重启选项
- [ ] **日志查看** — 添加窗口显示 Gateway 实时日志
- [ ] **自动更新** — 集成 electron-updater（可选）
- [ ] **开机自启** — 支持 macOS/Windows 开机自动启动
- [ ] **Windows 完整测试** — 验证 Windows .exe 安装和运行

---

## 版本信息

- **OpenClaw**：2026.3.9
- **Electron**：35+（v35 及以上）
- **Node.js**：22+（与 monorepo 保持一致）
- **pnpm**：10+（与 monorepo 保持一致）
- **TypeScript**：5.6+

---

## 开发工作流

### 开发模式

```bash
# 编译 UI + 启动 Electron（带 DevTools）
pnpm desktop:dev
```

### 生产构建

```bash
# 完整构建 + 打包
pnpm desktop:build

# 输出位置
ls -lh apps/electron/build/
```

### 代码同步上游

```bash
# 拉取上游最新代码
git pull upstream main

# 处理可能的冲突（通常只有 ui/src/ui/navigation.ts）
# 冲突内容：hiddenTabs 过滤逻辑

# 重新构建
pnpm desktop:build
```

---

## 参考资源

- **Electron 文档**：https://www.electronjs.org/docs
- **electron-builder**：https://www.electron.build/
- **OpenClaw 核心架构**：见根目录 `CLAUDE.md` 和 `AGENTS.md`

