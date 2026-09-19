# 架构

```text
Discord 官方 Bot
  -> 原始消息事件（新建/编辑/删除）
  -> 严格历史交易腿
  -> 版本化有限资金回放（现金/持仓/费用/权益曲线）
  -> PostgreSQL -> REST API -> 网页复盘

前向模拟路径：
  原始消息事件
  -> 规则解析器
  -> 可选 AI 结构化解析
  -> 风控与资金约束
  -> 人工确认
  -> 模拟订单/成交/持仓账本
  -> PostgreSQL（当前仍保留人工确认闸门）
  -> REST API + SSE
  -> 网页工作台
```

## 运行形态

- `dist/`：可单独发布到 GitHub Pages 的静态演示。
- `server/`：Node.js 后端，提供 API、SSE、Discord Bot 和 AI 适配器。
- `db/migrations/`：PostgreSQL 版本化迁移。
- 无 `DATABASE_URL`：内存演示仓库，不持久化，适合测试。
- 有 `DATABASE_URL`：PostgreSQL 正式仓库。
- `npm run db:replay`：读取最近一次历史导入，追加一个 `finite-capital-v1` 回放版本；长桥只用于期末未平仓估值。

## 可信边界

Discord 文本、附件、AI 输出、行情响应和网页输入全部是不可信输入。历史回放属于离线分析，不能直接变成前向订单；只有经过结构验证、规则检查、风险检查和人工确认的指令，才可进入前向模拟订单账本。真实券商下单不在当前系统能力范围内。
