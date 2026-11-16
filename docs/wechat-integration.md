# 微信同步与 AI 提取

Windows 连接器使用本机已登录的微信，调用外部读取助手的 `WeChatClient` 只读接口。原环境的助手基于 Apache-2.0 项目 [wechatauto-replica](https://github.com/fanyuantaier/wechatauto-replica)，固定基础提交 `46fa7395efbf66a20b73366d40ba5e672b1f74ef`，附有本机适配。运行真实微信同步前，需自行安装兼容助手并核对微信版本。

## 启动连接器

1. 按 [项目说明](../README.md) 启动 ClassFlow。
2. 将 `tools/wechat/config.example.json` 复制为同目录的 `wechat.local.json`。填写读取助手目录、经验证的微信版本、ClassFlow 地址和要同步的准确会话名单。
3. 在仓库根目录用读取助手虚拟环境的 Python 检查配置并启动。在运行时输入本地 ClassFlow 账号和密码。

```powershell
$bridgePython = 'C:/path/to/wechat-assistant/.venv/Scripts/python.exe'
& $bridgePython tools/wechat/bridge.py --check
& $bridgePython tools/wechat/bridge.py
```

连接器以 SQLite 保存水位和发送队列，服务端按稳定消息标识去重。文字、引用及可读卡片信息保存至收件箱，原附件仍通过微信查看。首次默认建立水位，从后续新消息开始同步。电脑及微信恢复运行后，连接器从水位继续读取。

## 启用 AI

默认用本地规则识别行动和截止时间。若选择云端 AI，在交互终端用以下命令输入自己的接口、模型和允许分析的群名。

```bash
npx tsx apps/api/src/wechat-ai-config.ts https://api.example.com/v1/chat/completions model-name "示例群"
```

配置脚本以一条合成消息验证模型。凭据在提示后输入，保存于实例数据目录，重启后生效。AI 只分析允许范围内的新文字通知，可能将同一会话的少量近期原文发送到所配置的模型服务。任务须有可校验的原文依据，含糊的任务进入人工核对。真实同步前请确认会话和模型服务的授权范围。

离线验证使用合成通知，运行 `npm test` 和 `npm run test:wechat`。
