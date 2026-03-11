# Desktop App 文档

OpenClaw Desktop Application 的完整文档。

---

## 快速导航

| 文档 | 内容 | 对象 |
|------|------|------|
| [安装与初始化](setup.md) | 下载、安装、首次启动流程 | 新用户 |
| [首次运行配置](first-run-config.md) | 配置 AI 提供商、API 密钥、环境变量 | 开发者、高级用户 |
| [故障排除](troubleshooting.md) | 常见问题与解决方案 | 所有用户 |

---

## 文档概览

### 新用户入门

1. **[安装与初始化](setup.md)**
   - 如何下载和安装 Desktop App
   - 首次启动时自动初始化做了什么
   - Gateway 和 Web UI 的基本概念

2. **[首次运行配置](first-run-config.md)** （可选）
   - 了解首次运行配置文件结构
   - 支持的 LLM 提供商（Anthropic、DeepSeek、自托管等）
   - 如何切换不同的 AI 服务

### 常见问题

3. **[故障排除](troubleshooting.md)**
   - Gateway 启动失败
   - 认证和连接问题
   - LLM 服务连接问题
   - 性能问题

### 开发者与高级用户

- **[../AGENTS.md](../AGENTS.md)** — Desktop App 技术设计文档
  - 架构设计
  - 关键文件和代码
  - Electron + Gateway subprocess 实现细节
  - 构建流程和依赖管理

---

## 配置场景

### 默认配置（Anthropic Claude）

使用 Anthropic 官方 API，无需特殊配置。

**文档**：[首次运行配置 — 场景 1](first-run-config.md#场景-1-anthropic-官方-api默认)

### 第三方 LLM 服务

使用 DeepSeek、OpenRouter 等第三方提供商。

**文档**：[首次运行配置 — 场景 2-5](first-run-config.md#场景-2-deepseek第三方-openai-兼容-api)

### 自托管 LLM

运行本地 LLM 服务（Ollama、LM Studio 等）。

**文档**：[首次运行配置 — 场景 3](first-run-config.md#场景-3-自托管-llmolamallamamistra)

---

## 相关资源

- **主项目文档**：https://docs.openclaw.ai
- **GitHub Releases**：https://github.com/openclaw/openclaw/releases
- **Discord 社群**：https://discord.gg/clawd
- **技术设计**：[AGENTS.md](../AGENTS.md)

---

## 更新历史

**2026.3.11**
- 新增 Desktop App 首次运行自动初始化功能
- 新增对第三方 LLM 服务支持（custom baseUrl）
- 完整的文档迁移和整理
