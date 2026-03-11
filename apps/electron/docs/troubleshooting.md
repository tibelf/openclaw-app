# 故障排除指南

Desktop App 常见问题与解决方案。

---

## 应用启动问题

### 问题：Gateway process exited unexpectedly

**症状**：应用启动后立即显示错误，无法显示 Web UI。

**可能原因**：
- node_modules 损坏或不完整
- pnpm 路径配置错误
- Gateway 启动参数错误

**解决步骤**：

1. **检查日志**：
   ```bash
   log stream --predicate 'process == "OpenClaw"' --level debug
   ```

2. **重启应用**（清除临时状态）：
   ```bash
   pkill OpenClaw
   sleep 2
   open -a OpenClaw
   ```

3. **重新安装应用**：
   - 从 [GitHub Releases](https://github.com/openclaw/openclaw/releases) 下载最新 DMG
   - 卸载旧版本应用，安装新版本

---

### 问题：应用启动很慢（超过 30 秒）

**症状**：首次启动时 UI 加载缓慢，onboarding 过程没有进展。

**可能原因**：
- LLM 服务响应缓慢
- 网络连接问题
- onboarding 进程卡住

**解决步骤**：

1. **验证网络连接**：
   ```bash
   ping api.deepseek.com        # 如果使用 DeepSeek
   # 或
   ping api.anthropic.com        # 如果使用 Anthropic
   ```

2. **检查 API 可达性**：
   ```bash
   curl -v https://api.deepseek.com/v1/models \
     -H "Authorization: Bearer sk-xxx"
   ```

3. **查看实时日志**：
   ```bash
   log stream --predicate 'process == "OpenClaw"' --level debug | grep -E "(FirstRun|Gateway|onboard)"
   ```

4. **手动启动 onboarding**（测试）：
   ```bash
   rm ~/.openclaw/openclaw.json
   ```
   然后重启应用重新初始化。

---

## 连接与认证问题

### 问题：Web UI 显示 "unauthorized: gateway token missing"

**症状**：Web UI 加载但无法连接到 Gateway，显示认证错误。

**可能原因**：
- Gateway 和 Web UI 之间的 token 不匹配
- Gateway 启动失败但应用继续加载 UI

**解决步骤**：

1. **重启应用**：
   ```bash
   pkill OpenClaw && sleep 2 && open -a OpenClaw
   ```

2. **检查 Gateway 进程**：
   ```bash
   ps aux | grep gateway
   # 应该看到 pnpm openclaw gateway 进程运行
   ```

3. **查看 Gateway 日志**：
   ```bash
   tail -f ~/.openclaw/gateway.log 2>/dev/null || echo "Log not found"
   ```

---

### 问题：API 认证失败 (401 Unauthorized)

**症状**：连接到 LLM 服务时出现 401 错误。

**可能原因**：
- API 密钥错误或过期
- API 密钥格式不正确
- 服务不支持该密钥

**解决步骤**：

1. **验证 API 密钥**：
   ```bash
   # 检查保存的配置
   cat ~/.openclaw/openclaw.json | grep -A 5 "models"

   # 或手动测试
   curl https://api.anthropic.com/v1/messages \
     -H "x-api-key: sk-ant-your-key" \
     -H "Content-Type: application/json" \
     -d '{"model":"claude-opus-4-1","max_tokens":1024,"messages":[{"role":"user","content":"hi"}]}'
   ```

2. **重新配置 API 密钥**：
   ```bash
   # 删除配置，重新初始化
   rm ~/.openclaw/openclaw.json

   # 或使用环境变量覆盖
   OPENCLAW_BUNDLED_API_KEY=sk-new-key open -a OpenClaw
   ```

3. **检查 API 密钥格式**：
   - Anthropic: 应以 `sk-ant-` 开头
   - DeepSeek: 应以 `sk-` 开头
   - 某些服务可能需要特殊格式（查阅服务文档）

---

## LLM 服务连接问题

### 问题：无法连接到自托管 LLM (localhost:11434)

**症状**：使用 Ollama 或其他本地 LLM 时，连接失败。

**可能原因**：
- Ollama 进程未运行
- baseUrl 配置错误
- 防火墙阻止连接

**解决步骤**：

1. **启动 Ollama**：
   ```bash
   ollama serve
   # 或检查 Ollama 是否已运行
   ps aux | grep ollama
   ```

2. **验证本地 LLM 可达性**：
   ```bash
   curl -v http://localhost:11434/api/tags
   # 应返回可用的模型列表
   ```

3. **检查配置中的 baseUrl**：
   ```bash
   cat ~/.openclaw/openclaw.json | grep -i baseurl
   # 应显示 http://localhost:11434/v1
   ```

4. **重新配置**（如需要）：
   ```bash
   # 编辑配置文件
   nano ~/.openclaw/openclaw.json

   # 修改 models.providers.custom.baseUrl 为正确的端点
   # 保存后重启应用
   ```

---

### 问题：DeepSeek 或其他第三方服务超时

**症状**：连接到 DeepSeek、OpenRouter 等服务时超时或返回 5xx 错误。

**可能原因**：
- 服务暂时不可用
- 网络连接问题
- API 配额已用完

**解决步骤**：

1. **测试 API 连接**：
   ```bash
   curl -v "https://api.deepseek.com/v1/models" \
     -H "Authorization: Bearer sk-your-key"
   ```

2. **查看 API 状态页**：
   - DeepSeek: https://status.deepseek.com (如果有)
   - OpenRouter: https://openrouter.ai

3. **检查 API 配额**：
   - 登录服务提供商的控制面板
   - 确认配额未用完，账户状态正常

4. **尝试切换模型**：
   ```bash
   nano ~/.openclaw/openclaw.json
   # 修改 model 字段试试其他模型
   ```

---

## 配置问题

### 问题：首次运行后没有看到预期的配置

**症状**：应用启动完成，但 `~/.openclaw/openclaw.json` 配置不正确。

**可能原因**：
- `first-run-defaults.json` 配置有误
- onboarding 过程中断
- 环境变量覆盖无效

**解决步骤**：

1. **检查配置文件**：
   ```bash
   cat ~/.openclaw/openclaw.json | jq .
   # 验证 models.providers 字段是否包含预期的配置
   ```

2. **查看 onboarding 日志**：
   ```bash
   log stream --predicate 'process == "OpenClaw"' | grep -i "firstrun\|onboard"
   ```

3. **手动重新初始化**：
   ```bash
   rm ~/.openclaw/openclaw.json
   OPENCLAW_BUNDLED_API_KEY=sk-your-key open -a OpenClaw
   ```

---

## 性能问题

### 问题：应用卡顿、响应缓慢

**症状**：Web UI 响应慢，消息发送/接收延迟大。

**可能原因**：
- LLM 服务响应慢
- Gateway 进程 CPU/内存占用过高
- 网络连接不稳定

**解决步骤**：

1. **检查 Gateway 进程状态**：
   ```bash
   ps aux | grep gateway | grep -v grep
   # 查看 CPU 和内存占用
   ```

2. **查看系统资源**：
   ```bash
   # 打开 Activity Monitor
   open -a "Activity Monitor"
   # 搜索 OpenClaw 或 node，查看资源占用
   ```

3. **重启 Gateway**（可选）：
   ```bash
   pkill -f "gateway run"
   sleep 2
   open -a OpenClaw
   ```

---

## 数据与文件问题

### 问题：workspace 目录丢失或权限问题

**症状**：应用提示找不到 workspace，或无法写入数据。

**可能原因**：
- workspace 目录被删除
- 文件权限不正确
- 磁盘空间不足

**解决步骤**：

1. **检查 workspace 目录**：
   ```bash
   ls -la ~/openclaw-workspace/
   # 或查看配置中的目录
   cat ~/.openclaw/openclaw.json | grep workspace
   ```

2. **创建缺失的目录**：
   ```bash
   mkdir -p ~/openclaw-workspace/{skills,hooks}
   chmod 755 ~/openclaw-workspace
   ```

3. **修复文件权限**：
   ```bash
   chmod -R 755 ~/.openclaw/
   chmod 755 ~/openclaw-workspace/
   ```

---

## 日志与调试

### 查看应用日志

**实时日志**：
```bash
log stream --predicate 'process == "OpenClaw"' --level debug
```

**过滤特定内容**：
```bash
# 只看错误信息
log stream --predicate 'process == "OpenClaw"' --level error

# 只看 first-run 相关
log stream --predicate 'process == "OpenClaw"' | grep -i firstrun

# 只看 Gateway 相关
log stream --predicate 'process == "OpenClaw"' | grep -i gateway
```

### 导出完整日志

```bash
# 导出最近 1 小时的日志到文件
log collect --output /tmp/openclaw-logs.tar.gz --predicate 'process == "OpenClaw"' --start -1h
```

---

## 联系支持

如果上述步骤无法解决问题，请：

1. **收集诊断信息**：
   ```bash
   # 收集配置
   cat ~/.openclaw/openclaw.json

   # 收集日志
   log collect --output /tmp/openclaw-debug.tar.gz --predicate 'process == "OpenClaw"'

   # 检查应用版本
   defaults read /Applications/OpenClaw.app/Contents/Info | grep CFBundleShortVersionString
   ```

2. **提交 Issue**：
   - GitHub: https://github.com/openclaw/openclaw/issues
   - 包含错误描述、日志摘录和诊断信息

3. **Discord 社群求助**：
   - https://discord.gg/clawd
   - 频道：#desktop-app 或 #help

---

## 相关文档

- [安装与初始化](setup.md)
- [首次运行配置](first-run-config.md)
- [主项目故障排除](https://docs.openclaw.ai/help/faq)
