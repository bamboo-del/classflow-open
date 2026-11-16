# ClassFlow · 班务流

团支书工作台。把通知、待办、日程、电子手册和小组课件集中在一个带登录权限的工作区。

- **通知与日程**：保存通知原文，关联待办，查看截止日期和完成进度。
- **电子手册**：按表单登记团务记录，支持图片和备份恢复。
- **小组演示**：上传和隔离播放单文件 HTML。可直接打开 [智慧水利与国防课件](courseware/01-water-defense.html) 查看示例源码。
- **微信同步**：Windows 连接器按会话名单读取新消息，先保存原文，再尝试提取待办。可选接入兼容 OpenAI Chat Completions 的模型。

## 本地运行

需要 Node.js 24.7+ 和 npm。先创建本机管理员，按终端提示输入密码。

```bash
npm ci
npm run admin -- init admin
npm run dev
```

打开 `http://127.0.0.1:5174/`。本地 API 使用 4318 端口，应用首次启动创建 SQLite 数据库。可先创建一条虚构通知和待办体验完整流程，无需微信或模型密钥。

```bash
npm run lint
npm run typecheck
npm test
npm run test:wechat
npm run build
```

前端在 `apps/web`，Fastify API 和 SQLite 迁移在 `apps/api`，共享校验在 `packages/shared`。生产部署可参考 [通用部署文档](docs/deployment.md)。

微信连接器需要另行安装兼容的本地读取助手。[微信同步与 AI 配置](docs/wechat-integration.md)

项目源码采用 [MIT](LICENSE)。仓库包含源码、通用配置和示例课件，实际团务资料、账号、群聊记录和密钥由各实例自行保存。
