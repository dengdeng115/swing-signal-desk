# 波段信号台

Discord 美股波段频道消息留档、结构化解析、有限资金模拟跟单、持仓和收益复盘工作台。

- 在线静态演示：https://dengdeng115.github.io/swing-signal-desk/
- 当前版本：v0.4.0
- 状态：本机 Discord、PostgreSQL、近一月历史回放和长桥只读报价已启用；AI 与长期在线后端尚未启用。

## 已有能力

- 规则解析“减仓止盈半仓 NVDA 价格220”等中文指令。
- 模糊、条件性或低置信度消息标记为不可自动模拟。
- 同一消息混合多个动作或标的时强制标记歧义，等待人工拆分。
- 检查资金利用率、单股集中度、现金垫和消息时延。
- 保存 Discord 新建、编辑、删除事件的数据模型。
- 提供 REST API、SSE 推送、PostgreSQL 迁移和内存演示模式。
- 预留 Discord 官方 Bot 与 OpenAI 严格结构化输出适配器。
- GitHub Actions 自动测试；GitHub Pages 自动发布静态网页。
- 按 100 万美元有限资金、70% 总仓、12% 单股上限完成历史账户回放。
- 记录每次模拟买卖的时间、股数、信号价、滑点成交价、费用、已实现盈亏和成交后权益。
- 网页展示动画账户权益曲线、买卖标记、最大回撤、资金利用率和当前模拟持仓。

## 快速开始

```powershell
npm ci
Copy-Item .env.example .env
npm start
```

打开 `http://localhost:8787`。默认使用内存演示仓库，不需要数据库密码。

```powershell
npm test
npm run db:verify
npm run db:replay
```

## 项目地图

- `dist/`：静态网页。
- `server/src/`：API、规则解析、风控、Discord 和 AI 适配器。
- `db/migrations/`：PostgreSQL 数据库版本。
- `test/`：解析、风控和 API 自动测试。
- `docs/PROJECT_CONTEXT.md`：目标、边界、默认规则和下次继续入口。
- `docs/ARCHITECTURE.md`：架构和可信边界。
- `docs/DATA_DICTIONARY.md`：11 张表、全部字段、状态值、指标口径和 Navicat 只读查询。
- `docs/SECURITY.md`：Discord 权限、密钥与 AI 安全规则。
- `docs/OPERATIONS.md`：本机、数据库、Discord 和 AI 操作步骤。
- `docs/POSTGRES_SETUP.md`：PostgreSQL 权限、Navicat、迁移、验证、备份和故障排查。
- `docs/ROADMAP.md`：已完成与下一阶段。
- `docs/CHANGELOG.md`：逐次变更和验证记录。

## 重要边界

本项目目前只做记录、分析和模拟交易，不连接真实券商，不执行真实订单。账户增长率是带固定仓位、滑点和费用假设的历史估算，不是实际券商收益，也不构成投资建议。

密钥只能保存在服务器环境变量中，禁止提交 `.env`、Discord Token、数据库密码或模型 API Key。
