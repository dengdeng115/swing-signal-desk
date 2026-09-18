# 运行手册

## 本机演示后端

```powershell
npm ci
Copy-Item .env.example .env
npm start
```

访问 `http://localhost:8787`，健康检查为 `http://localhost:8787/api/health`。默认使用内存数据，重启即清空。

## PostgreSQL 初始化

本机 PostgreSQL 已完成初始化。详细的角色、Navicat、迁移、验证和故障排查见 `docs/POSTGRES_SETUP.md`。不要把密码发到聊天或提交到 GitHub。

```powershell
npm run db:migrate
npm run db:verify
npm start
```

健康检查必须显示 `storage: postgres` 与 `database: swing_signal_desk`。应用使用 `swing_signal_app`；Navicat 日常查看使用 `swing_signal_readonly`，不要长期使用 `postgres` 超级用户。

## Discord 接入

先完成 `docs/SECURITY.md` 中的权限。

1. 在 Discord Developer Portal 创建官方 Bot，并在 Bot 页面仅开启 Message Content Intent。
2. 把 Application ID 写入本机或服务器的 `DISCORD_APPLICATION_ID`。它不是密钥，但仍不应硬编码到前端。
3. 生成最小权限邀请链接：

   ```text
   https://discord.com/oauth2/authorize?client_id=<APPLICATION_ID>&permissions=66560&scope=bot
   ```

4. 由有权管理目标服务器的管理员打开链接并加入 `duobot`；在目标频道确认 View Channel 与 Read Message History 权限。
5. 在 Developer Portal 创建或重置 Token，由用户本人直接写入本机/服务器的 `DISCORD_BOT_TOKEN`。不要把 Token 发到聊天或提交 Git。
6. 把订阅列表写入 `DISCORD_SUBSCRIPTIONS_JSON`，然后设置 `DISCORD_ENABLED=true`。

`DISCORD_SUBSCRIPTIONS_JSON` 中每项包含 `guildId`、`channelId` 和 `authorIds`；`authorIds` 可包含多人，空数组表示监听该频道全部非 Bot 发布者。采集器逐条匹配订阅，不会把不同频道和作者交叉组合。

首次启用后先在测试频道发送一条新消息，再编辑并删除；逐条核对原文、编辑记录、接收延迟和解析结果。确认无误后才切换到正式频道。

## AI 接入

设置 `AI_ENABLED=true`、`OPENAI_API_KEY`、`OPENAI_MODEL`。AI 只在规则结果不完整或置信度不足时调用；上线前需用真实历史样本做离线评测。
