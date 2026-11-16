# ClassFlow 架构

## 边界

本地开发由 Vite 转发同源 /api 请求。生产由现有 HTTPS 代理转发到宿主机回环端口，再到独立 Fastify 容器。Fastify 同源提供静态前端和 API，登录后才挂载业务页面。服务端在业务请求进入参数校验和存储层之前验证会话。存储层继续使用 Drizzle 和 SQLite。

apps/web 是工作台及交互组件。apps/api/src/app.ts 是 HTTP 层，repository.ts 是存储替换边界，schema.ts 描述数据表。packages/shared 提供传输对象、枚举、导入校验、北京时间规则及统计。个人数据量较小时一次读取一致快照，界面筛选与汇总使用同一份数据。每次写入后重新读取，切回窗口也会刷新。

## 单管理员身份边界

security.sqlite 与业务库同槽独立持久化。admin 表使用固定主键约束单管理员。仅 CLI 可创建或重置密码。密码使用 Argon2id，随机 16 字节盐、64 MiB、3 次迭代、并行度 1。sessions 仅保存 32 字节随机会话令牌的 SHA-256 摘要和绝对到期时间，会话有效期 12 小时。退出删除该会话，重置密码时在同一写事务中撤销全部会话。业务导出与备份均排除身份库。[Node.js Argon2](https://nodejs.org/docs/latest-v24.x/api/crypto.html#cryptoargon2algorithm-parameters-callback)

attempts 在身份库中按来源 IP 和总量记录登录尝试，10 分钟内单源最多 6 次，全局最多 48 次，同一服务最多 3 个并发密码验证。生产 Cookie 使用 __Host- 前缀、Secure、HttpOnly、SameSite=Strict 和 Path=/。本机 HTTP 使用独立名称且不设置 Secure。浏览器修改请求须有精确 Origin 和自定义请求头，不开放跨源凭据。Host 从原始请求检查；代理默认不受信任，仅接受显式指定的单一代理 IP。[OWASP CSRF 指南](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)

公开路由仅提供静态资源、存活检查、登录和当前请求是否已登录的布尔状态。所有现有 /api/ 业务路由默认拒绝匿名用户。私有业务响应带 no-store；生产响应带 CSP、HSTS、禁止嵌入和 MIME 嗅探等响应头。服务端只依赖同源，由反向代理终止 TLS。

## 模型

- notices 以 UUID 为主键。保存 original 原文、source 来源、receivedAt 接收时间、notes 私人备注、processed 处理状态和 createdAt。转任务仅创建关联，通知的处理状态由用户手动决定。
- tasks 以 UUID 为主键，包含标题、描述、分类、优先级、状态、日期、可空时间、负责人、可空来源通知外键、私人或未来可公开标记，以及创建、修改与完成时间。通知与任务为一对多。任务删除只影响该任务。
- 北京日期和时间分别存 YYYY-MM-DD 和 HH:mm。未填写时间的当天任务到翌日才逾期，有时间的任务在截止分钟结束后显示逾期。时间戳为 UTC ISO 8601。今日待办包括今日已过时的未完成任务；未来七天为明天至第七天，均含首尾；周为周一至周日。完成率为完成数除以全部任务数，取整，空库为 0%。周进度按该周截止任务计算。

## 接口与数据恢复

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | /api/workspace | 任务和通知的一致快照 |
| POST | /api/notices | 保存原文 |
| PATCH | /api/notices/:id | 切换处理状态 |
| POST | /api/tasks | 新建任务，省略可见性时为私人 |
| PUT / DELETE | /api/tasks/:id | 编辑、完成、重新打开或删除 |
| GET | /api/backup | 导出通知、任务及电子手册备份 |
| POST | /api/backup/preview | 校验文件，返回导入前后数量与当前数据摘要指纹 |
| POST | /api/backup/restore | 核验确认标记、文件和数据库指纹，先备份旧数据再事务恢复 |

恢复会拒绝未知字段和版本、无效日期、重复 ID、缺失的来源通知以及完成状态不一致。预览后若工作区被改动则返回 409。恢复在 SQLite 写事务中生成旧数据 JSON 并落盘，再按顺序替换记录，任何写入失败均回滚。备份含原文及内部备注，交由使用者保管。

## 初始化与迁移

首次启动自动创建 data/classflow.sqlite，启用外键，在写事务内执行 apps/api/migrations/001_initial.sql 并设置 PRAGMA user_version = 1。以后启动同版本直接打开；遇到不认识的版本会停止。为新版本添加顺序编号 SQL，更新 Drizzle 表定义与迁移分派，事务中逐版本执行并更新 user_version。迁移前导出 JSON 并离线另存数据库，先用副本试运行。备份格式版本与数据库迁移版本独立演进。

## 界面及动效来源

工作台采用六项指标与两栏摘要，窄屏改为底部导航。Motion 用于页面切换。Anime.js 将本地「贝字新片」motion-kit.html 中从左展开标尺的动效移植到周进度条，时长缩短至 240ms。两处均尊重系统减弱动态效果设置。运行时字体、图标、脚本与图片均在本机加载。

上游项目：[Motion](https://github.com/motiondivision/motion)、[Anime.js](https://github.com/juliangarnier/anime)。

## 后续路线

微信接入增加有鉴权的 `POST /api/integrations/wechat/messages`。Windows 连接器只读取配置名单中的会话，经本地持久队列同步。数据访问层以稳定来源 ID 去重，在单个事务保存通知原文及私人任务，不改变业务库和备份版本。相对日期按消息时间的北京时间解析；不明确事项留在收件箱。实现边界、上游来源和启动方法见 [微信接入](wechat-integration.md)。

1. **正式接入**。本地已验证登录、同源生产构建、隔离 HTTPS、持久卷与归档恢复。真实接入前需填齐目标主机、域名、代理差异、异地存储和生产授权，见 [部署文档](deployment.md)。
2. **班级试点**。新增班级和成员关系，区分管理员和学生权限。新增单独的学生侧投影接口、公告和显式发布操作。学生响应只含白名单字段，由服务端校验身份、班级、可见范围和发布状态。原始通知、内部备注与来源通知 ID 均留在管理侧。“未来可公开”只是意向标记。小程序复用有鉴权的后端。
3. **产品化**。按归属为任务和通知补充 classId、ownerId，历史数据经过明确归属迁移。数据访问层的所有读写、统计、备份按租户与角色约束。替换 PostgreSQL 适配与迁移脚本，验证唯一性、时区与事务语义，并加跨班与越权回归测试。
