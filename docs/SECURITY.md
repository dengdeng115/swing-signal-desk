# 安全与权限

## Discord 管理员需要配置

- 将官方 Bot 邀请到目标服务器。
- 目标频道权限：View Channel、Read Message History。
- Developer Portal 中启用 Message Content Intent，否则普通消息正文不可用。
- 只有需要机器人在频道回复时才授予 Send Messages；当前采集器不需要管理员权限，也不需要 Manage Guild。
- 不使用个人用户 Token，不做 self-bot，不申请与采集无关的权限。

## 密钥

- `DISCORD_BOT_TOKEN`、`OPENAI_API_KEY`、`DATABASE_URL` 仅放服务器环境变量或密钥管理服务。
- `.env` 被 Git 忽略；`.env.example` 只能放空值和说明。
- 日志不得输出 Authorization、密码、完整连接串或 Token。

## AI

- 模型输出使用严格 JSON Schema。
- 模型不能调用真实交易工具。
- 模糊、条件性、缺价格、缺仓位或低置信度结果必须人工确认或拒绝。
- 保存模型名、提示版本、输入事件和输出候选，以便复盘。
