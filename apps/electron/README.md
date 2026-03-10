# OpenClaw Electron Desktop App

为消费者打造的 OpenClaw 跨平台桌面应用（Mac + Windows）。

## 特点

- **一体化打包**：用户只需下载 `.dmg`（Mac）或 `.exe`（Windows）安装包，无需安装 Node.js
- **与上游同步**：核心逻辑完全复用上游代码，UI 通过参数控制可视化功能，维护成本极低
- **托盘常驻**：应用在系统托盘中常驻，关闭窗口不退出进程
- **自定义皮肤**：通过 Preload 脚本注入配置，可隐藏高级功能、修改品牌名等

## 架构

```
Electron App
├── Main Process (Node.js)
│   ├── 直接启动 Gateway（in-process，不是 subprocess）
│   ├── 创建 BrowserWindow
│   ├── 注入 Preload 脚本（配置）
│   └── 托盘管理
└── Renderer (Chromium)
    └── Web UI（原始上游 UI，通过参数过滤 Tab）
        └── WebSocket 连接 Gateway
```

**关键优势**：
- Gateway 不需要作为独立进程启动，直接在 Main Process 中加载
- Web UI 代码**零修改**（只改了一处 `navigation.ts`）
- 上游更新 → git pull → `pnpm desktop:build` 即可重新打包

## 开发

### 安装依赖

```bash
pnpm install
```

### 开发模式运行

```bash
pnpm desktop:dev
```

这个命令会：
1. 编译 Web UI（`pnpm ui:build`）
2. 启动 Electron 应用（加载本地编译的 Gateway 和 Web UI）
3. 打开浏览器 DevTools（方便调试）

### 生成安装包

```bash
pnpm desktop:build
```

输出：
- macOS：`dist/electron/OpenClaw-*.dmg`、`dist/electron/OpenClaw-*.zip`
- Windows：`dist/electron/OpenClaw Setup *.exe`

## 自定义配置

编辑 `apps/electron/src/preload.ts` 中的配置：

```ts
window.__OPENCLAW_DESKTOP__ = {
  hiddenTabs: ['debug', 'nodes', 'instances'], // 隐藏的高级 Tab
  brandName: 'MyApp',                          // 品牌名（可选）
  gatewayUrl: 'ws://localhost:18789',         // Gateway WebSocket 地址
};
```

## 同步上游

```bash
# 拉取上游最新
git pull upstream main

# 重新打包
pnpm desktop:build
```

**冲突最小化**：唯一可能冲突的是 `ui/src/ui/navigation.ts`，改动只有一处，修复成本极低。

## 目录结构

```
apps/electron/
├── src/
│   ├── main.ts          # Electron Main Process（启动 Gateway + UI）
│   ├── preload.ts       # Preload 脚本（配置注入）
│   └── gateway.d.ts     # 类型声明（跳过模块路径检查）
├── ui/
│   ├── index.html       # 自定义 UI 入口
│   └── custom.css       # 品牌样式覆盖
├── dist/                # 构建输出（.js 文件）
├── package.json
├── tsconfig.json
└── electron-builder.yml # 打包配置
```

## 常见问题

**Q：为什么 UI 看起来和 Web UI 一样？**
A：这是设计的一部分。前期保持完全一致，后期可以自定义样式和隐藏功能。

**Q：能否删除某些功能而不是只隐藏？**
A：可以。隐藏只是 UI 层面的，功能本身还在 Gateway 中。如果要完全移除功能，需要修改 Gateway 代码。

**Q：Gateway 如何重启？**
A：现在没有重启按钮。可以选择：
1. 关闭应用→重新打开（硬重启）
2. 在菜单栏添加"重启 Gateway"选项

**Q：能否自定义 Gateway 端口？**
A：可以。修改 `apps/electron/src/main.ts` 中的 `const PORT = 18789` 即可。

## 技术栈

- **Electron 35+**：跨平台桌面框架
- **TypeScript**：类型安全
- **Lit Web Components**：轻量级 UI 框架（来自上游）
- **electron-builder**：打包工具

## 许可

MIT（与 OpenClaw 保持一致）
