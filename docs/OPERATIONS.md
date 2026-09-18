# 运行手册

## 本机演示后端

```powershell
npm ci
Copy-Item .env.example .env
npm start
```

访问 `http://localhost:8787`，健康检查为 `http://localhost:8787/api/health`。默认使用内存数据，重启即清空。

## PostgreSQL 初始化

本机已有 PostgreSQL 13。不要把密码发到聊天或提交到 GitHub。

1. 在 Navicat 中连接 `localhost`。
2. 新建专用数据库 `swing_signal_desk` 和最小权限专用用户，避免让应用长期使用 `postgres` 超级用户。
3. 在本机 `.env` 写入 `DATABASE_URL`。
4. 执行 `npm run db:migrate`。
5. 再执行 `npm start`，确认健康检查中的 `storage` 为 `postgres`。

## Discord 接入

先完成 `docs/SECURITY.md` 中的权限。把 Token 与频道 ID 写入服务器环境变量，然后设置 `DISCORD_ENABLED=true`。首次启用后用测试频道发送样本消息，逐条核对原文、编辑记录、接收延迟和解析结果。

## AI 接入

设置 `AI_ENABLED=true`、`OPENAI_API_KEY`、`OPENAI_MODEL`。AI 只在规则结果不完整或置信度不足时调用；上线前需用真实历史样本做离线评测。
