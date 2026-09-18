# 变更记录

## 2026-09-18 · Discord 应用配置

- 在 Discord Developer Portal 创建官方 Bot `duobot`。
- 已开启 Message Content Intent；Presence Intent 与 Server Members Intent 保持关闭。
- 固定最小邀请权限为 View Channel + Read Message History（权限整数 `66560`），不授予发言或管理员权限。
- 增加 Application ID、最小权限邀请、私密频道权限覆盖和 Token 保管的操作说明。
- 当前仍未启用真实采集：等待服务器管理员完成邀请，以及用户本人把 Token 写入被 Git 忽略的本机环境变量。
- 修改前验证：`npm ci` 成功，`npm test` 12/12 通过，依赖审计为 0 个漏洞。

## 2026-09-18 · Discord 精确范围过滤

- 增加 `DISCORD_GUILD_ID` 与 `DISCORD_AUTHOR_IDS` 配置。
- 消息必须同时匹配服务器、频道、发布者，并且发布者不能是 Bot，才会进入留档和解析流程。
- 增加多订阅配置和 `discord_subscriptions` 数据表；每个频道可独立配置多个发布者，也可监听该频道全部非 Bot 用户。
- 真实 Discord ID 仅保存在被 Git 忽略的本机 `.env`，不进入公开仓库。

## 2026-09-18 · v0.2.0 基础后端

- 增加 Node.js API、SSE、内存仓库和 PostgreSQL 仓库。
- 增加 PostgreSQL 初始迁移，覆盖消息事件、解析、人工决定、行情、模拟订单、成交、持仓快照和审计。
- 增加中文交易指令规则解析器和资金风控。
- 增加官方 Discord Bot 采集骨架，保留 create/update/delete 事件。
- 增加 OpenAI Responses API 严格结构化输出适配器；默认关闭，不包含密钥或默认模型。
- 增加项目上下文、数据字典、安全、运行与路线图文档。
- 本地验证：`npm test` 8/8 通过；`/api/health` 返回 v0.2.0、memory；示例“减仓止盈半仓 NVDA 价格220”解析为 NVDA / sell / 50%，并保留人工确认闸门。
- GitHub 验证：基础提交 `f402bcd` 的 CI 与 Pages 工作流均成功；线上页面返回 HTTP 200，并包含后端状态探测代码。

## 2026-09-18 · v0.1.0 静态原型

- 完成波段信号、持仓、资金利用率、交易记录和收益复盘的动画网页演示。
- 使用 GitHub Pages 发布公开网址。
