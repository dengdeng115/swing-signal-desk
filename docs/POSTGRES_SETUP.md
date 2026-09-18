# PostgreSQL 配置与维护

## 当前已验证状态

- PostgreSQL：13.21（`server_version_num = 130021`）
- 地址：`127.0.0.1:5432`
- 数据库：`swing_signal_desk`
- 应用角色：`swing_signal_app`
- Navicat 只读角色：`swing_signal_readonly`
- 时区：UTC
- 已执行迁移：`001_initial_schema.sql`、`002_discord_subscriptions.sql`
- 应用连接池上限：10；角色连接上限：20
- `pgcrypto`：1.3

真实密码只存在本机 `.env` 的 `DATABASE_URL` 与 `DATABASE_READONLY_URL`。不要把这两行复制到聊天、Issue、截图或 Git。

## 权限模型

`swing_signal_app` 是数据库所有者，只能登录自己的数据库；它不是超级用户，不能创建数据库、角色或复制流，连接上限为 20。数据库默认设置：UTC、15 秒语句超时、5 秒锁等待、30 秒空闲事务超时。

`swing_signal_readonly` 专供 Navicat 日常查看。它具有 `CONNECT`、`USAGE` 和表 `SELECT`，默认事务只读，写入会返回 PostgreSQL `25006`。未来由 `swing_signal_app` 创建的新表会自动授予它 `SELECT`。

## 日常启动与验证

```powershell
npm ci
npm run db:migrate
npm run db:verify
npm start
```

访问 `http://localhost:8787/api/health`，必须同时看到：

```json
{
  "ok": true,
  "integrations": { "discord": true },
  "storage": "postgres",
  "database": "swing_signal_desk"
}
```

`db:migrate` 只执行 `schema_migrations` 中尚未登记的 SQL 文件。新增结构必须在 `db/migrations/` 追加新文件，禁止修改已经执行过的迁移。

## Navicat 安全连接

日常查看请新建连接，不要使用 `postgres` 超级用户：

| 设置 | 值 |
|---|---|
| 主机 | `127.0.0.1` |
| 端口 | `5432` |
| 初始数据库 | `swing_signal_desk` |
| 用户名 | `swing_signal_readonly` |
| 密码 | 本机 `.env` 的 `DATABASE_READONLY_URL` 中对应密码 |
| SSL | 本机回环测试可关闭；远程部署必须重新评估并启用 TLS |

连接后先执行：

```sql
select current_database(), current_user,
       current_setting('default_transaction_read_only');
```

预期分别为 `swing_signal_desk`、`swing_signal_readonly`、`on`。

## 首次初始化记录

本机原 `pg_hba.conf` 全部使用 `scram-sha-256`，命令行没有保存 `postgres` 密码。首次创建角色时没有读取或导出 Navicat 密码，而是：

1. 将原 `pg_hba.conf` 备份到仓库外的本机工作备份目录并校验 SHA-256。
2. 临时增加一条只匹配 `127.0.0.1`、`postgres` 用户以及 `postgres,swing_signal_desk` 两个数据库的 `trust` 规则。
3. 创建两个随机 256 位密码的最小权限角色和项目数据库。
4. 立即删除临时规则，并用备份逐字节恢复原文件。
5. 再次确认无密码 `postgres` 连接失败，原文件 SHA-256 恢复为 `844B54976378EA64CF9440355D8D637090712707F11E6BBF20C21C09CD75CB6A`。

这是一项已经完成的一次性本机引导，不是日常操作。以后优先使用现有角色和迁移器；不要为了方便把 `trust` 长期留在认证配置中。

## 备份与恢复边界

当前只完成结构、权限和连接验证，尚未建立自动备份。正式积累频道数据前必须增加：

- 每日 `pg_dump` 自定义格式备份；
- 至少一份复制到不同磁盘或加密远程存储；
- 定期在临时数据库做恢复演练；
- 记录备份时间、文件哈希、PostgreSQL 主版本和恢复结果。

不要把含真实 Discord 消息或密钥的数据库备份提交到 GitHub。

## 常见故障

- 健康检查显示 `memory`：确认 `.env` 中 `DATABASE_URL` 非空，然后重启 Node 服务。
- `28P01` 或“密码认证失败”：不要改成永久 `trust`；检查连接使用的角色和本机 `.env`。
- `25006`：当前是只读角色，属于预期保护；迁移和应用必须使用 `swing_signal_app`。
- `relation does not exist`：执行 `npm run db:migrate`，再运行 `npm run db:verify`。
- 服务重启后 Discord 离线：同时检查 `DISCORD_ENABLED=true`、Bot Token 和 `/api/health`。
