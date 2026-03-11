# 首次运行配置详解

本文档详细说明 Desktop App 首次启动时如何配置 AI 提供商、API 密钥和其他设置。

---

## 快速开始

首次启动时，Application 自动读取 `first-run-defaults.json` 进行初始化。你可以通过以下方式定制：

### 1. 使用环境变量（最简单）

```bash
# 覆盖 API 密钥
OPENCLAW_BUNDLED_API_KEY=sk-xxx ./OpenClaw.app/Contents/MacOS/OpenClaw

# macOS Spotlight
OPENCLAW_BUNDLED_API_KEY=sk-xxx open -a OpenClaw
```

### 2. 修改配置文件（已安装应用）

编辑 `~/.openclaw/openclaw.json`：

```bash
nano ~/.openclaw/openclaw.json
```

修改后重启应用生效。

### 3. 自定义构建（开发者）

编辑 `apps/electron/config/first-run-defaults.json`，重新构建应用：

```bash
pnpm desktop:build
```

---

## 配置文件结构

`first-run-defaults.json` 的完整结构：

```json
{
  "ai": {
    "provider": "anthropic",          // 或 "custom", "openrouter"
    "apiKey": "sk-ant-xxx",            // 可通过 OPENCLAW_BUNDLED_API_KEY 覆盖
    "model": "claude-haiku-4-5-20251001",
    "baseUrl": "",                      // 仅 provider=custom 时生效
    "compatibility": "openai"           // 或 "anthropic"
  },
  "gateway": {
    "port": 18789,
    "bind": "loopback"
  },
  "workspace": {
    "dir": ""                           // 为空则用 ~/openclaw-workspace
  },
  "skills": {
    "enabled": [],                      // 默认 Skills 列表
    "nodeManager": "npm"
  },
  "hooks": {
    "enabled": [],                      // 默认 Hooks 列表
    "enableInternal": true              // 启用内置 Hooks
  }
}
```

---

## 配置场景

### 场景 1: Anthropic 官方 API（默认）

使用 Anthropic Claude 模型，无需额外配置。

**配置**：
```json
{
  "ai": {
    "provider": "anthropic",
    "apiKey": "sk-ant-your-api-key",
    "model": "claude-opus-4-1-20250805",
    "baseUrl": "",
    "compatibility": "openai"
  },
  "gateway": { "port": 18789, "bind": "loopback" },
  "workspace": { "dir": "" },
  "skills": { "enabled": [], "nodeManager": "npm" },
  "hooks": { "enabled": [], "enableInternal": true }
}
```

**首次启动执行**：
```bash
pnpm openclaw onboard --non-interactive --accept-risk \
  --anthropic-api-key sk-ant-your-api-key \
  --workspace ~/openclaw-workspace \
  --skip-health
```

---

### 场景 2: DeepSeek（第三方 OpenAI 兼容 API）

使用 DeepSeek LLM 提供商。

**配置**：
```json
{
  "ai": {
    "provider": "custom",
    "apiKey": "sk-deepseek-your-api-key",
    "model": "deepseek-chat",
    "baseUrl": "https://api.deepseek.com/v1",
    "compatibility": "openai"
  },
  "gateway": { "port": 18789, "bind": "loopback" },
  "workspace": { "dir": "" },
  "skills": { "enabled": [], "nodeManager": "npm" },
  "hooks": { "enabled": [], "enableInternal": true }
}
```

**特点**：
- `provider`: `custom` — 表示使用自定义 baseUrl
- `baseUrl`: DeepSeek 的 API 端点
- `compatibility`: `openai` — DeepSeek 兼容 OpenAI 接口

---

### 场景 3: 自托管 LLM（Ollama / LLaMA）

使用本地运行的 LLM 服务。

**配置**：
```json
{
  "ai": {
    "provider": "custom",
    "apiKey": "local-key",              // 本地服务通常不需要密钥
    "model": "mistral",
    "baseUrl": "http://localhost:11434/v1",
    "compatibility": "openai"
  },
  "gateway": { "port": 18789, "bind": "loopback" },
  "workspace": { "dir": "" },
  "skills": { "enabled": [], "nodeManager": "npm" },
  "hooks": { "enabled": [], "enableInternal": true }
}
```

**前置条件**：
- Ollama 运行在 `localhost:11434`，支持 OpenAI 兼容接口
- 或其他兼容 OpenAI 的 LLM 服务（例如 vLLM、LM Studio）

---

### 场景 4: 自托管 Anthropic 兼容服务

企业内部部署的 Anthropic API 兼容服务。

**配置**：
```json
{
  "ai": {
    "provider": "custom",
    "apiKey": "internal-api-key-xxx",
    "model": "claude-opus",
    "baseUrl": "https://anthropic-api.internal.company.com/v1",
    "compatibility": "anthropic"       // 关键：指定 anthropic 兼容性
  },
  "gateway": { "port": 18789, "bind": "loopback" },
  "workspace": { "dir": "" },
  "skills": { "enabled": [], "nodeManager": "npm" },
  "hooks": { "enabled": [], "enableInternal": true }
}
```

**特点**：
- `compatibility`: `anthropic` — 服务兼容 Anthropic API
- baseUrl 指向企业内部 API

---

### 场景 5: OpenRouter（第三方聚合）

使用 OpenRouter 访问多个 LLM 提供商。

**配置**：
```json
{
  "ai": {
    "provider": "openrouter",
    "apiKey": "sk-or-your-api-key",
    "model": "openai/gpt-4-turbo",      // OpenRouter 模型格式
    "baseUrl": "",                      // 使用 OpenRouter 默认 baseUrl
    "compatibility": "openai"
  },
  "gateway": { "port": 18789, "bind": "loopback" },
  "workspace": { "dir": "" },
  "skills": { "enabled": [], "nodeManager": "npm" },
  "hooks": { "enabled": [], "enableInternal": true }
}
```

**特点**：
- `provider`: `openrouter` — 内置 OpenRouter 提供商
- 模型格式：`provider/model` 例如 `openai/gpt-4-turbo`

---

## 配置字段参考

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `ai.provider` | string | ✅ | `anthropic` \| `custom` \| `openrouter` |
| `ai.apiKey` | string | ❌ | API 密钥，支持环境变量 `OPENCLAW_BUNDLED_API_KEY` 覆盖 |
| `ai.model` | string | ✅ | 模型 ID（对于 custom，无需带 provider 前缀） |
| `ai.baseUrl` | string | ❌ | 第三方 API 基础 URL（仅 `provider=custom` 时有效） |
| `ai.compatibility` | string | ❌ | `openai` \| `anthropic`（仅 `provider=custom` 时生效） |
| `gateway.port` | number | ✅ | Gateway 监听端口（默认 18789） |
| `gateway.bind` | string | ✅ | 绑定地址（建议 `loopback` 本地隐私） |
| `workspace.dir` | string | ❌ | workspace 目录（为空则用 `~/openclaw-workspace`） |
| `skills.enabled` | array | ❌ | 默认启用的 Skills 列表 |
| `skills.nodeManager` | string | ❌ | Node 包管理器（`npm` \| `pnpm` \| `bun`） |
| `hooks.enabled` | array | ❌ | 默认启用的 Hooks 列表 |
| `hooks.enableInternal` | boolean | ❌ | 是否启用内置 Hooks |

---

## 环境变量覆盖

### OPENCLAW_BUNDLED_API_KEY

覆盖 `ai.apiKey` 字段。用于 CI/CD 或打包脚本安全地注入 API 密钥。

```bash
# 方式 1: 应用启动时设置
OPENCLAW_BUNDLED_API_KEY=sk-xxx ./OpenClaw.app/Contents/MacOS/OpenClaw

# 方式 2: 构建时设置
OPENCLAW_BUNDLED_API_KEY=sk-xxx pnpm desktop:build
```

**优先级**：`OPENCLAW_BUNDLED_API_KEY` > `first-run-defaults.json` > 交互式 onboarding

---

## 首次运行工作流

```
应用启动
  ↓
检查 ~/.openclaw/openclaw.json 是否存在
  ↓
[如果不存在]
  ├─ 读取 first-run-defaults.json
  ├─ 运行非交互式 onboarding
  │   └─ 创建 models.providers 配置
  ├─ 复制默认 Skills（如果配置）
  ├─ 复制默认 Hooks（如果配置）
  └─ 启用内置 Hooks（如果配置）
  ↓
[已存在或初始化完成]
  ├─ 启动 Gateway 子进程
  ├─ 等待 Gateway 就绪
  ├─ 加载 Web UI
  └─ 显示应用窗口
```

---

## 故障排除

### 问题：应用启动卡顿，onboarding 很慢

**原因**：LLM 服务响应缓慢或网络不稳定

**解决**：
1. 验证 API baseUrl 和网络连接
2. 查看应用日志：`log stream --predicate 'process == "OpenClaw"'`
3. 检查 `~/.openclaw/openclaw.json` 是否正确生成

### 问题：provider=custom 但无法连接

**原因**：baseUrl 错误或服务不可达

**检验**：
```bash
# 测试 API 连接
curl https://api.deepseek.com/v1/models \
  -H "Authorization: Bearer sk-xxx"

# 或测试本地服务
curl http://localhost:11434/v1/models
```

### 问题：API 认证失败 (401 Unauthorized)

**原因**：API 密钥错误或格式不正确

**解决**：
1. 验证 API 密钥是否正确复制
2. 某些服务需要特殊格式（例如 `Bearer sk-...`）— 查阅服务文档
3. 确保 apiKey 未过期或被撤销

---

## 高级用法

### CI/CD 集成 — GitHub Actions

构建带有自定义 API 密钥的 Desktop App：

```yaml
name: Build Desktop App with Custom Provider

on: [push]

jobs:
  build:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '22'

      - name: Install pnpm
        run: npm install -g pnpm

      - name: Build with DeepSeek
        env:
          OPENCLAW_BUNDLED_API_KEY: ${{ secrets.DEEPSEEK_API_KEY }}
        run: |
          # 修改配置文件
          jq '.ai.provider = "custom" |
              .ai.baseUrl = "https://api.deepseek.com/v1" |
              .ai.model = "deepseek-chat"' \
            apps/electron/config/first-run-defaults.json > /tmp/config.json
          mv /tmp/config.json apps/electron/config/first-run-defaults.json

          # 构建
          pnpm desktop:build

      - name: Upload artifacts
        uses: actions/upload-artifact@v4
        with:
          name: desktop-app
          path: apps/electron/build/*.dmg
```

---

## 验证首次运行配置

1. **删除现有配置**：
   ```bash
   rm -rf ~/.openclaw/
   ```

2. **启动应用**（设置环境变量或修改配置文件后）：
   ```bash
   ./OpenClaw.app/Contents/MacOS/OpenClaw
   ```

3. **观察日志**：
   ```bash
   log stream --predicate 'process == "OpenClaw"' --level debug
   ```

4. **验证配置生成**：
   ```bash
   cat ~/.openclaw/openclaw.json
   # 应显示 models.providers 包含正确的 provider/model 配置
   ```

5. **检查 Web UI**：
   - 打开浏览器 http://localhost:18789
   - 检查"健康状况"标签页显示"在线"

---

## 相关文档

- [安装与初始化](setup.md)
- [故障排除](troubleshooting.md)
- [主项目配置文档](https://docs.openclaw.ai/concepts/models)
