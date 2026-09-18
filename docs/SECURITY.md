# 安全与权限

## Discord 管理员需要配置

- 将官方 Bot 邀请到目标服务器。
- 目标频道权限：View Channel、Read Message History。
- 邀请权限整数固定为 `66560`（`1024 + 65536`）；不要勾选 Administrator、Send Messages、Manage Server。
- Developer Portal 中启用 Message Content Intent，否则普通消息正文不可用。
- 只有需要机器人在频道回复时才授予 Send Messages；当前采集器不需要管理员权限，也不需要 Manage Guild。
- 不使用个人用户 Token，不做 self-bot，不申请与采集无关的权限。

服务器管理员还需要在目标频道的权限覆盖中确认 `duobot` 实际拥有 View Channel 和 Read Message History。仅把 Bot 加入服务器，并不保证它能看到私密频道。

## 密钥

- `DISCORD_BOT_TOKEN`、`OPENAI_API_KEY`、`DATABASE_URL`、`DATABASE_READONLY_URL` 仅放服务器环境变量或密钥管理服务。
- `.env` 被 Git 忽略；`.env.example` 只能放空值和说明。
- 日志不得输出 Authorization、密码、完整连接串或 Token。
- Bot Token 只在 Discord Developer Portal 创建或重置后显示一次；不要发送到聊天、截图、GitHub Issue 或网页前端。
- 应用使用非超级用户 `swing_signal_app`；Navicat 日常检查使用默认事务只读的 `swing_signal_readonly`。不要让应用或日常查看长期使用 `postgres`。

## AI

- 模型输出使用严格 JSON Schema。
- 模型不能调用真实交易工具。
- 模糊、条件性、缺价格、缺仓位或低置信度结果必须人工确认或拒绝。
- 保存模型名、提示版本、输入事件和输出候选，以便复盘。
