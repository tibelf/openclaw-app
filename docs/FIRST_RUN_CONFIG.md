/\*\*

- first-run-defaults.json 配置示例
-
- 本文件展示如何配置不同的 AI provider，支持内置 provider（anthropic、openrouter）
- 和第三方自定义服务（custom）。
  \*/

// ===== 示例 1: 使用 Anthropic（默认）=====
{
"ai": {
"provider": "anthropic",
"apiKey": "sk-ant-xxx",
"model": "claude-haiku-4-5-20251001",
"baseUrl": "",
"compatibility": "openai"
},
"gateway": { "port": 18789, "bind": "loopback" },
"workspace": { "dir": "" },
"skills": { "enabled": [], "nodeManager": "npm" },
"hooks": { "enabled": [], "enableInternal": true }
}

// ===== 示例 2: 使用 DeepSeek（第三方 OpenAI 兼容 API）=====
{
"ai": {
"provider": "custom",
"apiKey": "sk-deepseek-xxx",
"model": "deepseek-chat",
"baseUrl": "https://api.deepseek.com/v1",
"compatibility": "openai"
},
"gateway": { "port": 18789, "bind": "loopback" },
"workspace": { "dir": "" },
"skills": { "enabled": [], "nodeManager": "npm" },
"hooks": { "enabled": [], "enableInternal": true }
}

// ===== 示例 3: 自托管 LLM（OpenAI 兼容）=====
{
"ai": {
"provider": "custom",
"apiKey": "local-api-key",
"model": "mistral-7b",
"baseUrl": "http://localhost:8000/v1",
"compatibility": "openai"
},
"gateway": { "port": 18789, "bind": "loopback" },
"workspace": { "dir": "" },
"skills": { "enabled": [], "nodeManager": "npm" },
"hooks": { "enabled": [], "enableInternal": true }
}

// ===== 示例 4: 自托管 Anthropic 兼容服务 =====
{
"ai": {
"provider": "custom",
"apiKey": "self-hosted-key",
"model": "claude-opus",
"baseUrl": "https://anthropic-api.internal.example.com",
"compatibility": "anthropic"
},
"gateway": { "port": 18789, "bind": "loopback" },
"workspace": { "dir": "" },
"skills": { "enabled": [], "nodeManager": "npm" },
"hooks": { "enabled": [], "enableInternal": true }
}

// ===== 示例 5: OpenRouter（内置第三方提供商）=====
{
"ai": {
"provider": "openrouter",
"apiKey": "sk-or-xxx",
"model": "openai/gpt-4-turbo",
"baseUrl": "",
"compatibility": "openai"
},
"gateway": { "port": 18789, "bind": "loopback" },
"workspace": { "dir": "" },
"skills": { "enabled": [], "nodeManager": "npm" },
"hooks": { "enabled": [], "enableInternal": true }
}

/\*\*

- 配置字段说明
-
- ai.provider
- - "anthropic": 使用 Anthropic 官方 API
- - "custom": 使用第三方服务（需配置 baseUrl）
- - "openrouter": 使用 OpenRouter 中介服务
-
- ai.apiKey
- - API 密钥，可通过环境变量 OPENCLAW_BUNDLED_API_KEY 覆盖
- - 不设置时，onboarding 跳过 API 密钥参数
-
- ai.model
- - 模型 ID，例如 "claude-haiku-4-5-20251001" 或 "deepseek-chat"
- - 对于 custom provider，无需带 provider 前缀
-
- ai.baseUrl
- - 第三方服务的 API 基础 URL，仅 provider=custom 时有效
- - 格式：https://api.example.com/v1（通常以 /v1 结尾）
- - 为空时，custom provider 配置被忽略
-
- ai.compatibility
- - "openai": API 兼容 OpenAI（默认）
- - "anthropic": API 兼容 Anthropic（用于自托管 Anthropic 服务）
- - 仅在 provider=custom 时传给 onboarding
-
- 环境变量覆盖
- - OPENCLAW_BUNDLED_API_KEY：覆盖 ai.apiKey
- 示例：
-     OPENCLAW_BUNDLED_API_KEY=sk-xxx pnpm desktop:build
  \*/
