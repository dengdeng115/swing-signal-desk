# 数据字典

| 表 | 粒度 | 用途 | 关键字段 |
|---|---|---|---|
| `portfolios` | 每个模拟组合一行 | 资金、现金和风控上限 | `initial_capital`, `current_cash`, `current_equity` |
| `discord_message_events` | 每次消息事件一行 | 保存新建、编辑、删除，不覆盖历史 | `discord_message_id`, `event_type`, `content`, `received_at` |
| `signal_interpretations` | 每次解析一行 | 保存规则或 AI 的候选结构 | `parser_version`, `symbol`, `action`, `confidence`, `status` |
| `review_decisions` | 每次人工决定一行 | 确认、忽略、拒绝或修正 | `decision`, `reviewer`, `edited_payload` |
| `market_quotes` | 每个标的每个行情时点一行 | 区分行情时间和收到时间 | `source`, `bid`, `ask`, `last_price`, `quote_time` |
| `paper_orders` | 每个模拟订单一行 | 保存下单意图与当时风控快照 | `quantity`, `order_type`, `status`, `risk_snapshot` |
| `paper_fills` | 每笔模拟成交一行 | 计算延迟、滑点、费用和可执行收益 | `signal_price`, `fill_price`, `fees`, `signal_to_fill_ms` |
| `position_snapshots` | 每个标的每次快照一行 | 重建持仓与盈亏变化 | `quantity`, `average_cost`, `market_value`, `captured_at` |
| `audit_events` | 每个关键行为一行 | 可追溯失败、配置变化和人工操作 | `actor_type`, `action`, `entity_type`, `details` |

## 口径

- 资金利用率：持仓市值绝对值合计 / 账户权益。
- 理论信号收益：用频道文字中的参考价格计算，只用于对照。
- 可执行模拟收益：使用消息接收后可获得的行情、延迟、滑点和费用计算。
- 置信度：解析器对结构完整性的估计，不代表交易成功概率。
- `is_executable`：表示结构是否足以生成候选模拟单，不代表风控通过，也不代表真实下单授权。
