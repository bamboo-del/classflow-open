# 第二阶段运行手册

## 发布门禁

在自己的部署环境中选择域名、代理和备份位置。示例域名使用 .invalid 后缀，部署前换成自己的域名。本地隔离演练使用 Windows amd64 上的 Linux Docker 引擎。

## 环境与镜像

使用独立 Linux 目录，例如 /srv/classflow。以批准的提交创建只包含本项目的发布目录，保留上一版本镜像标签和摘要。Compose 项目固定为 classflow。检查同名容器、卷、网络、回环端口，任何归属不明的资源均需另选名称或停下核对。生产基础镜像按 digest 固定。运行阶段仅带应用构建产物、API 生产依赖、共享类型模块和迁移 SQL。运行身份为 node，根文件系统只读。预留足够内存供 Argon2id 并行校验与 Node 运行。

在该目录执行下列命令。配置文件存在时直接审查它，避免覆盖。

```sh
umask 077
test -e .env.production || cp .env.production.example .env.production
chmod 600 .env.production
# 编辑 .env.production，填入确认过的 HTTPS Origin、唯一版本镜像标签与空闲回环端口
sh deploy/ops.sh check
# 只在生产门禁批准后执行
CLASSFLOW_CHANGE_APPROVED=yes sh deploy/ops.sh apply
docker compose -p classflow --env-file .env.production exec app node apps/api/dist/admin.js init admin
```

管理员密码仅在有 TTY 的宿主机终端输入。改密使用相同命令，将 init 换成 reset。受控密码管理器还可以通过私有标准输入配合 --password-stdin 调用，不要把密码放到参数、环境文件或 shell 历史。互联网浏览器访问独立 HTTPS 子域名。应用的 4318 仅在容器内监听，默认发布到宿主机 127.0.0.1:14318。/healthz 用于存活检查，业务读写另行验收。

宿主机 Caddy 使用 deploy/Caddyfile.fragment，Nginx 使用 deploy/nginx-location.conf.example 加入独立 HTTPS server。只添加一个新虚拟主机，保留原有主机的处理顺序及证书配置。代理向应用传入原始 Host，协议和源地址由受信代理重写。仅在核实应用实际看到的代理源地址后设置 CLASSFLOW_TRUST_PROXY 为该单个 IP。留空时忽略转发头，多位访问者可能共用一个登录限流桶。如果现有代理本身在容器中，它的 127.0.0.1 不是宿主机；需先形成已审批的专用代理网络或宿主机网关方案。

## 初次迁移

从旧版数据管理导出版本 1 JSON，另存独立副本。在新版本登录、选择文件，核对通知数与任务数，确认后恢复。按原文检查至少一条多任务通知和截止时间，再从新版本导出，排除 exportedAt 后比较两个 JSON 的通知和任务。服务端拒绝悬空关联、重复 ID、未知格式、无效状态或陈旧的预览。开始覆盖后遇到数据库写入错误也会事务回滚。保留原工作树和原数据库。

## 服务器备份

- 持久卷 classflow_data 中的 /var/lib/classflow/live 存放业务库与身份库。覆盖恢复前的业务 JSON 在当前槽的 backups/。归档卷 classflow_archives 挂在 /var/backups/classflow。
- 执行 `sh deploy/ops.sh backup`。脚本通过 SQLite 在线备份 API 生成一致快照，校验数据库版本、integrity_check、外键和业务字段，再原子发布。输出文件名、记录数量和按 ID 排序的内容 SHA-256。失败返回非零，并写 stderr 和可写情况下的 backup-failures.log。
- CLASSFLOW_BACKUP_KEEP 与 CLASSFLOW_BACKUP_DAYS 默认为 14 份、30 天。新快照成功后，根据两者清理旧的同格式归档。备份文件在 Linux 上为 0600，目录为 0700。手工导入前的 JSON 不参与该轮转。
- 调度由管理员在获批主机上安装。例如每天北京时间 02:15 执行下面的 cron（先核对主机时区），用 flock 避免定时任务重叠。手动执行同一批备份也应使用同一把锁。日志目录使用该部署用户拥有的私有目录。

```cron
15 2 * * * cd /srv/classflow && /usr/bin/flock -n /srv/classflow/.backup.lock sh deploy/ops.sh backup >> /srv/classflow/backup.log 2>&1
```

- 同机卷只覆盖应用重建。异机副本由运维在私有目录中通过 `docker compose -p classflow --env-file .env.production cp app:/var/backups/classflow/<快照文件名> ./<快照文件名>` 取出，确认本地权限后，通过已验证主机指纹的 SSH/rsync 转入加密存储。快照包含私人班务。远端路径、密钥和留存策略需单独配置。在独立机器定期演练恢复，对照记录数量与摘要。
- 业务归档排除管理员哈希、限流和会话。灾备时在恢复槽重新初始化管理员。普通重启或重建使用同一数据槽，已有登录和业务数据持续有效。

## 实际恢复与回滚

```sh
# 估算剩余空间，选不存在的新槽；命令拒绝覆盖已有目录
sh deploy/ops.sh restore-new <快照文件名> restore-20261104
# 将上条命令返回的 digest、tasks、notices 与归档时输出核对
# 获批切换后在 .env.production 设置 CLASSFLOW_DATA_SLOT=restore-20261104
docker compose -p classflow --env-file .env.production up -d --no-build --wait app
docker compose -p classflow --env-file .env.production exec app node apps/api/dist/admin.js init admin
```

恢复失败时保留现场，使用另一个全新槽重试。在新槽开放写入前复核业务数据。回滚时先停止该应用写入并导出切换后新增的数据，恢复上一镜像标签和旧 CLASSFLOW_DATA_SLOT，再运行同一条 up --no-build。旧槽及其身份库仍可用。首次上线撤销时仅停 classflow 的 app，按变更计划撤销独立代理路由。日常部署和回滚均禁止 down -v。

## 模型或版本迁移前

记录原镜像、业务库 user_version、身份库版本、记录数及当前数据槽。在旧版本上先做在线快照，恢复到新槽核验摘要，审查逐版 SQL 与破坏性 DDL，再在副本上升级并验证。确认回滚能从原槽启动后才批准真实迁移。当前业务模型和 Drizzle 迁移仍为版本 1。独立身份库有自己的版本号 1。若将来迁移身份库，另做受限的一致性备份或经批准重新初始化身份；业务归档不承载认证信息。
