# OpenClaw Electron App - 故障排除

## 应用启动后立即退出

### 问题
应用显示以下错误后自动退出：
```
[Electron] Failed to load gateway: Named export 'Mistral' not found. The requested module '@mistralai/mistralai' is a CommonJS module...
```

### 根本原因
这是**上游项目 openclaw 的依赖兼容性问题**：
- `@mariozechner/pi-ai@0.57.1` 使用 ESM `import` 语法
- `@mistralai/mistralai@1.10.0/1.14.1` 是 CommonJS 模块
- Node.js 无法将 CommonJS 导出转换为 ESM 命名导出

### 解决方案

#### 方案 1: 等待上游修复（推荐）
这个问题应该在上游项目中修复。可以：
1. 升级 `@mistralai/mistralai` 到支持 ESM 的版本
2. 修改 `@mariozechner/pi-ai` 的导入方式

#### 方案 2: 暂时禁用 Mistral 提供者
编辑 `~/.openclaw/openclaw.json` 配置文件，禁用 Mistral：
```json
{
  "model-selection": {
    "mistral": {
      "enabled": false
    }
  }
}
```

#### 方案 3: 使用 Web UI 替代
如果 Electron 应用无法启动，可以直接使用 Web UI：
```bash
# 在另一个终端启动网关
openclaw gateway run --port 18789

# 然后在浏览器中打开
open http://localhost:18789
```

### 本地开发测试
```bash
# 在项目根目录
cd apps/electron

# 开发模式（看错误日志）
pnpm dev

# 生产版本测试
pnpm build
./build/mac-arm64/OpenClaw.app/Contents/MacOS/OpenClaw
```

### 报告问题
如果继续遇到问题，请在上游项目报告：
- https://github.com/openclaw/openclaw/issues
- 包含错误信息和环境信息（macOS 版本、Node.js 版本等）
