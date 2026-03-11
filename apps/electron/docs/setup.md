# Desktop App 安装与初始化指南

这是使用 OpenClaw Desktop 应用的快速入门指南。Desktop App 是一个独立的 macOS/Windows 应用，无需安装 Node.js，开箱即用。

---

## 下载与安装

### macOS

1. 从 [GitHub Releases](https://github.com/openclaw/openclaw/releases) 下载最新的 DMG 文件
   - `OpenClaw-YYYY.M.D-arm64.dmg`（Apple Silicon / M1/M2/M3）
   - `OpenClaw-YYYY.M.D-x64.dmg`（Intel Mac）

2. 打开 DMG 文件，将 OpenClaw 拖入 Applications 文件夹

3. 从 Applications 中启动应用，或用 Spotlight 搜索 "OpenClaw"

### Windows

1. 从 [GitHub Releases](https://github.com/openclaw/openclaw/releases) 下载最新的 EXE 文件
   - `OpenClaw Setup YYYY.M.D.exe`

2. 运行安装程序，按提示完成安装

3. 从开始菜单或桌面启动 OpenClaw

---

## 首次运行 — 自动初始化

首次启动应用时，OpenClaw 会自动完成以下初始化步骤：

✅ **自动执行**（无需用户干预）
- 运行 onboarding 流程配置 AI 提供商和 API 密钥
- 创建 workspace 目录（默认 `~/openclaw-workspace`）
- 复制默认 Skills（如果配置）
- 安装默认 Hooks（如果配置）
- 启动 Gateway（本地 HTTP/WebSocket 服务）
- 加载 Web UI

**第一次启动可能需要 10-15 秒**，取决于网络连接和 LLM 服务响应速度。

---

## 配置覆盖

### 方法 1: 修改配置文件（高级）

编辑 `~/.openclaw/openclaw.json`，重启应用即可生效：

```bash
# 查看当前配置
cat ~/.openclaw/openclaw.json

# 编辑配置（使用你喜欢的编辑器）
nano ~/.openclaw/openclaw.json
```

### 方法 2: 环境变量覆盖

重启应用前设置环境变量：

```bash
# 覆盖 API 密钥
export OPENCLAW_BUNDLED_API_KEY=sk-xxx
./OpenClaw.app/Contents/MacOS/OpenClaw

# 或启动脚本方式
OPENCLAW_BUNDLED_API_KEY=sk-xxx open -a OpenClaw
```

### 方法 3: 自定义 first-run 配置（开发者）

修改打包前的配置文件 `apps/electron/config/first-run-defaults.json`，重新构建应用。

---

## 切换 AI 提供商

首次运行后，若要切换到不同的 LLM 提供商（例如从 Anthropic 切换到 DeepSeek）：

1. 删除现有配置：
   ```bash
   rm ~/.openclaw/openclaw.json
   ```

2. 重启应用，自动重新初始化

3. 按 onboarding 流程选择新的提供商和 API 密钥

或者，直接编辑 `~/.openclaw/openclaw.json` 修改 `models.providers` 部分。

详见 [配置详解](first-run-config.md)。

---

## Gateway 与 Web UI

Desktop App 在后台运行一个 Gateway 服务（本地 HTTP 服务，端口 18789）：

```
OpenClaw Desktop App
  ├── Electron Main Process
  │   └── Gateway 子进程 (http://localhost:18789)
  │       ├── HTTP API (供 Web UI 调用)
  │       └── WebSocket (实时推送)
  │
  └── BrowserWindow
      └── Web UI (加载自 http://localhost:18789)
```

**Gateway 特性**：
- 仅在本地 loopback 接口上运行（安全，不会暴露到网络）
- 与 CLI 版本的 Gateway 命令完全兼容
- 自动生成 token 进行认证

**无需额外配置**——应用启动时自动处理。

---

## 日志与故障排除

### 查看应用日志

```bash
# macOS 系统日志
log stream --predicate 'process == "OpenClaw"' --level debug

# 或检查 ~/.openclaw/ 目录
ls -la ~/.openclaw/
cat ~/.openclaw/openclaw.json
```

### 常见问题

**Q: 应用启动很慢**
A: 首次运行时 onboarding 需要时间。检查网络连接和 LLM 服务可达性。

**Q: 出现 "Gateway process exited unexpectedly"**
A: 见 [故障排除](troubleshooting.md)。

**Q: 无法连接到 LLM 服务**
A: 验证 API 密钥、baseUrl 和网络连接。详见 [故障排除](troubleshooting.md)。

---

## 与 CLI 版本对比

| 特性 | Desktop App | CLI |
|------|-------------|-----|
| 安装 Node.js | ❌ 不需要 | ✅ 需要 |
| 命令行 | ❌ 无 | ✅ 有 |
| Web UI | ✅ 内置 | ✅ 需要手动启动 |
| 开机自启 | ⏳ 未实现 | ✅ 支持（systemd/launchd） |
| Gateway 启动 | ✅ 自动 | ⏳ 手动 |
| 频繁迭代 | ⏳ 需重新安装 DMG | ✅ 支持 git pull + rebuild |

---

## 下一步

- [配置详解](first-run-config.md) — 了解 `first-run-defaults.json` 和第三方 LLM 支持
- [故障排除](troubleshooting.md) — 常见错误与解决方案
- [主项目文档](https://docs.openclaw.ai) — OpenClaw 完整功能指南
