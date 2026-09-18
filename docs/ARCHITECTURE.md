# 架构

```text
Discord 官方 Bot
  -> 原始消息事件（新建/编辑/删除）
  -> 规则解析器
  -> 可选 AI 结构化解析
  -> 风控与资金约束
  -> 人工确认
  -> 模拟订单/成交/持仓账本
  -> PostgreSQL
  -> REST API + SSE
  -> 网页工作台
```

## 运行形态

- `dist/`：可单独发布到 GitHub Pages 的静态演示。
- `server/`：Node.js 后端，提供 API、SSE、Discord Bot 和 AI 适配器。
- `db/migrations/`：PostgreSQL 版本化迁移。
- 无 `DATABASE_URL`：内存演示仓库，不持久化，适合测试。
- 有 `DATABASE_URL`：PostgreSQL 正式仓库。

## 可信边界

Discord 文本、附件、AI 输出、行情响应和网页输入全部是不可信输入。只有经过结构验证、规则检查、风险检查和人工确认的指令，才可进入模拟订单账本。真实券商下单不在当前系统能力范围内。
