# ⚠️ 已弃用 — 请查看 docs/first-run-config.md

本文档已弃用。完整的首次运行配置文档已迁移至：

**[docs/first-run-config.md](docs/first-run-config.md)**

该文档包含：
- 所有支持的配置场景
- 完整的字段参考
- 环境变量覆盖说明
- 故障排除指南
- CI/CD 集成示例

---

# 原文档内容（存档）

以下内容仅供参考。建议查看上面链接的最新文档。

## first-run-defaults.json 使用示例

本文档展示如何在不同场景下配置 `first-run-defaults.json`，以支持桌面应用首次启动时的自动初始化。

## 场景 1: Anthropic 官方 API（默认配置）

最简单的配置，使用 Anthropic 官方服务：

```json
{
  "ai": {
    "provider": "anthropic",
    "apiKey": "sk-ant-your-api-key-here",
    "model": "claude-haiku-4-5-20251001",
    "baseUrl": "",
    "compatibility": "openai"
  },
  "gateway": { "port": 18789, "bind": "loopback" },
  "workspace": { "dir": "" },
  "skills": { "enabled": [], "nodeManager": "npm" },
  "hooks": { "enabled": [], "enableInternal": true }
}
```

**onboarding 调用**：
```bash
pnpm openclaw onboard --non-interactive --accept-risk \
  --anthropic-api-key sk-ant-your-api-key-here \
  --workspace ~/openclaw-workspace \
  --skip-health
```

---

## 场景 2: DeepSeek（第三方 OpenAI 兼容 API）

使用 DeepSeek API 作为 LLM 提供商：

```json
{
  "ai": {
    "provider": "custom",
    "apiKey": "sk-deepseek-your-api-key-here",
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

**onboarding 调用**：
```bash
pnpm openclaw onboard --non-interactive --accept-risk \
  --auth-choice custom-api-key \
  --custom-base-url https://api.deepseek.com/v1 \
  --custom-model-id deepseek-chat \
  --custom-api-key sk-deepseek-your-api-key-here \
  --custom-compatibility openai \
  --workspace ~/openclaw-workspace \
  --skip-health
```

---

## 场景 3: 自托管 LLM（Ollama/Mistral/LLaMA）

使用本地运行的兼容 OpenAI 的 LLM 服务：

```json
{
  "ai": {
    "provider": "custom",
    "apiKey": "not-required-for-local",
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

**prerequisites**：
- Ollama/自托管 LLM 必须在 http://localhost:11434 运行
- 该实例必须支持 OpenAI API 兼容接口

**onboarding 调用**：
```bash
pnpm openclaw onboard --non-interactive --accept-risk \
  --auth-choice custom-api-key \
  --custom-base-url http://localhost:11434/v1 \
  --custom-model-id mistral \
  --custom-compatibility openai \
  --workspace ~/openclaw-workspace \
  --skip-health
```

---

## 场景 4: 自托管 Anthropic 兼容服务

使用企业内部部署的 Anthropic API 兼容服务：

```json
{
  "ai": {
    "provider": "custom",
    "apiKey": "internal-api-key-xxx",
    "model": "claude-opus",
    "baseUrl": "https://anthropic-api.internal.company.com/v1",
    "compatibility": "anthropic"
  },
  "gateway": { "port": 18789, "bind": "loopback" },
  "workspace": { "dir": "" },
  "skills": { "enabled": [], "nodeManager": "npm" },
  "hooks": { "enabled": [], "enableInternal": true }
}
```

**onboarding 调用**：
```bash
pnpm openclaw onboard --non-interactive --accept-risk \
  --auth-choice custom-api-key \
  --custom-base-url https://anthropic-api.internal.company.com/v1 \
  --custom-model-id claude-opus \
  --custom-api-key internal-api-key-xxx \
  --custom-compatibility anthropic \
  --workspace ~/openclaw-workspace \
  --skip-health
```

---

## 场景 5: OpenRouter（第三方聚合）

使用 OpenRouter 访问多个 LLM 提供商：

```json
{
  "ai": {
    "provider": "openrouter",
    "apiKey": "sk-or-your-api-key-here",
    "model": "openai/gpt-4-turbo",
    "baseUrl": "",
    "compatibility": "openai"
  },
  "gateway": { "port": 18789, "bind": "loopback" },
  "workspace": { "dir": "" },
  "skills": { "enabled": [], "nodeManager": "npm" },
  "hooks": { "enabled": [], "enableInternal": true }
}
```

**onboarding 调用**：
```bash
pnpm openclaw onboard --non-interactive --accept-risk \
  --openrouter-api-key sk-or-your-api-key-here \
  --workspace ~/openclaw-workspace \
  --skip-health
```

---

## 环境变量覆盖

所有配置都支持通过环境变量 `OPENCLAW_BUNDLED_API_KEY` 覆盖 `ai.apiKey`：

```bash
# 覆盖 first-run-defaults.json 中的 apiKey
OPENCLAW_BUNDLED_API_KEY=sk-xxx pnpm desktop:build

# 或运行应用时设置
OPENCLAW_BUNDLED_API_KEY=sk-xxx ./OpenClaw.app/Contents/MacOS/OpenClaw
```

此功能允许 CI/CD 流程或打包脚本安全地注入 API 密钥，而无需在版本控制中存储敏感信息。

---

## 配置字段参考

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `ai.provider` | string | ✅ | `anthropic` / `custom` / `openrouter` |
| `ai.apiKey` | string | ❌ | API 密钥，支持环境变量覆盖 |
| `ai.model` | string | ✅ | 模型 ID（custom 时无需带 provider 前缀） |
| `ai.baseUrl` | string | ❌ | 第三方服务 URL（provider=custom 时生效） |
| `ai.compatibility` | string | ❌ | `openai` / `anthropic`（provider=custom 时生效） |

---

## 故障排除

### 问题：provider=custom 但 baseUrl 为空
**症状**：应用启动后无法连接模型
**原因**：`custom` provider 要求必须设置 `baseUrl`
**解决**：确保 `baseUrl` 字段不为空，格式为 `https://api.example.com/v1`

### 问题：onboarding 卡住或超时
**症状**：应用首次启动时 UI 无响应
**原因**：LLM 服务不可达或响应超时
**解决**：
1. 确认 LLM 服务是否在线（例如：`curl https://api.deepseek.com/v1/models`）
2. 检查网络连接和防火墙规则
3. 查看应用日志：`~/.openclaw/openclaw-app.log`

### 问题：认证失败 `invalid API key`
**症状**：连接时收到 401 错误
**原因**：API 密钥错误或已过期
**解决**：
1. 验证 `ai.apiKey` 或 `OPENCLAW_BUNDLED_API_KEY` 是否正确
2. 检查服务文档是否要求特殊格式（例如 `Bearer sk-...`）
3. 重新生成 API 密钥

---

## 高级配置：与 CI/CD 集成

### GitHub Actions 示例

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

      - name: Build with custom provider
        env:
          OPENCLAW_BUNDLED_API_KEY: ${{ secrets.DEEPSEEK_API_KEY }}
        run: |
          # 修改配置文件
          jq '.ai.provider = "custom" | .ai.baseUrl = "https://api.deepseek.com/v1" | .ai.model = "deepseek-chat"' \
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

2. **启动应用**：
   ```bash
   ./OpenClaw.app/Contents/MacOS/OpenClaw
   ```

3. **观察日志**：
   ```bash
   tail -f ~/.openclaw/openclaw-app.log
   ```

4. **验证配置**：
   ```bash
   cat ~/.openclaw/openclaw.json
   # 应该显示 provider、model、baseUrl 等配置
   ```

5. **测试连接**：
   - 打开 Web UI
   - 检查"健康状况"标签页
   - 应显示"在线"且连接到正确的 LLM 提供商
