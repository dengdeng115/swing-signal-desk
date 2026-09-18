# 数据库表与字段说明

这份文档用于解释 Swing Signal Desk 的 PostgreSQL 数据库。日常在 Navicat 中查看时，建议使用只读账号 `swing_signal_readonly`。本文不记录任何密码、Bot Token 或真实 Discord ID。

## 1. 先理解整条数据链

```text
Discord 服务器/频道/发布者
        │
        ▼
discord_subscriptions       决定监听范围
        │
        ▼
discord_message_events      原始消息事件，只追加、不覆盖
        │
        ▼
signal_interpretations      规则或 AI 生成的候选解释
        │
        ▼
review_decisions            人工确认、忽略、拒绝或修改
        │
        ▼
paper_orders                通过风控后生成模拟订单
        │
        ▼
paper_fills                 模拟成交、费用、滑点和延迟
        │
        ├──────────────► position_snapshots   持仓与盈亏快照
        └──────────────► portfolios           现金、权益和风控上限

market_quotes               独立保存行情，用于估值和模拟成交
audit_events                横跨全流程的审计记录
schema_migrations           记录已经执行过的数据库迁移
```

这里的“订单”和“成交”都只指模拟交易，不会连接真实券商下单。

## 2. 常见字段类型

| 类型 | 通俗解释 | 注意事项 |
|---|---|---|
| `uuid` | 系统生成的全局唯一编号 | 用来关联不同表；不是按时间递增的流水号 |
| `text` | 文字 | Discord 的超长整数 ID 也用文字保存，避免 JavaScript 精度丢失 |
| `numeric(p,s)` | 精确小数 | 适合金额、价格、比例和数量，不使用浮点数近似计算 |
| `boolean` | 真/假 | PostgreSQL 中显示为 `true` / `false` |
| `timestamptz` | 带时区的时间 | 数据库按 UTC 保存；Navicat 可按客户端时区显示 |
| `jsonb` | 可查询的 JSON 对象 | 用于保留原始载荷、解析详情和当时的规则快照 |
| `text[]` | 文字数组 | 例如一个候选被拦截的多条原因 |
| `bigint` | 大整数 | 目前用于毫秒延迟，可容纳很大的数值 |

## 3. 全部表总览

| 表 | 一行代表什么 | 主要用途 | 当前阶段 |
|---|---|---|---|
| `portfolios` | 一个模拟投资组合 | 记录初始资金、现金、权益和风控参数 | 已使用 |
| `discord_subscriptions` | 一个服务器/频道/发布者监听范围 | 控制 Bot 允许采集哪里、谁的消息 | 已使用 |
| `discord_message_events` | 一次消息创建、编辑、删除或测试事件 | 永久保留 Discord 原始历史 | 已使用 |
| `signal_interpretations` | 一次解析结果 | 保存规则或 AI 对消息的候选理解 | 已使用 |
| `review_decisions` | 一次人工审核动作 | 保存确认、忽略、拒绝或修改 | 已使用 |
| `market_quotes` | 某股票在某时点的一条行情 | 区分行情时间和系统收到时间 | 等待长桥接入 |
| `paper_orders` | 一张模拟订单 | 保存买卖意图和当时的风控快照 | 等待模拟成交模块 |
| `paper_fills` | 一笔模拟成交 | 保存成交价、滑点、费用和延迟 | 等待模拟成交模块 |
| `position_snapshots` | 某组合、某股票在某时点的持仓 | 重建持仓、权益和盈亏历史 | 等待模拟成交模块 |
| `audit_events` | 一次关键系统或人工行为 | 追踪安全修正、配置变化和异常 | 已使用 |
| `schema_migrations` | 一个已执行的迁移文件 | 防止重复建表或漏执行升级 | 已使用 |

部分表现在为空是正常的：长桥行情和完整模拟成交模块尚未接入，因此 `market_quotes`、`paper_orders`、`paper_fills`、`position_snapshots` 可能没有记录。

## 4. `portfolios`：模拟组合

一行表示一个模拟资金账户。当前默认组合初始资金为 1,000,000 USD。

| 字段 | 类型 | 是否必填 | 含义 |
|---|---|---:|---|
| `id` | `uuid` | 是 | 组合唯一编号，供订单和持仓表引用 |
| `name` | `text` | 是 | 组合显示名称，例如“默认模拟组合” |
| `base_currency` | `text` | 是 | 基础货币，默认 `USD` |
| `initial_capital` | `numeric(20,4)` | 是 | 起始本金，必须大于 0；不应随着交易变化 |
| `current_cash` | `numeric(20,4)` | 是 | 当前可用模拟现金 |
| `current_equity` | `numeric(20,4)` | 是 | 当前总权益，通常为现金加持仓市值 |
| `max_gross_utilization` | `numeric(8,6)` | 是 | 最大总资金利用率；`0.70` 表示最多使用 70% 权益 |
| `max_symbol_weight` | `numeric(8,6)` | 是 | 单一股票最大权重；`0.20` 表示最多占 20% 权益 |
| `min_cash_reserve` | `numeric(8,6)` | 是 | 最低现金保留比例；`0.30` 表示至少保留 30% 现金 |
| `created_at` | `timestamptz` | 是 | 组合创建时间 |
| `updated_at` | `timestamptz` | 是 | 组合最近更新时间 |

注意：`max_gross_utilization=0.70` 与 `min_cash_reserve=0.30` 是两道相互呼应的限制，但代码仍应分别检查，不能假定两者永远相加等于 1。

## 5. `discord_subscriptions`：Discord 监听范围

一行定义一个允许监听的范围。这样以后新增频道或发布者时，不需要改数据库结构。

| 字段 | 类型 | 是否必填 | 含义 |
|---|---|---:|---|
| `id` | `uuid` | 是 | 订阅唯一编号 |
| `guild_id` | `text` | 是 | Discord 服务器 ID；`guild` 就是服务器 |
| `channel_id` | `text` | 是 | Discord 频道 ID |
| `author_id` | `text` | 否 | 指定发布者 ID；为空表示监听该频道内所有非 Bot 用户 |
| `label` | `text` | 否 | 方便人看的备注名称，不参与权限判断 |
| `enabled` | `boolean` | 是 | 是否启用；关闭时设为 `false`，不要删除历史消息 |
| `created_at` | `timestamptz` | 是 | 订阅创建时间 |
| `updated_at` | `timestamptz` | 是 | 订阅最近修改时间 |

唯一约束会阻止同一个服务器、频道和发布者被重复添加。Bot 仍必须真实加入服务器并拥有目标频道的 View Channel 与 Read Message History 权限；数据库里有订阅不等于 Discord 已授权。

## 6. `discord_message_events`：Discord 原始事件

这是最重要的原始证据表。一条 Discord 消息被创建、编辑、删除时分别追加新行，不能用新内容覆盖旧行。

| 字段 | 类型 | 是否必填 | 含义 |
|---|---|---:|---|
| `id` | `uuid` | 是 | 本系统内部事件编号 |
| `discord_message_id` | `text` | 否 | Discord 消息 ID；创建、编辑和删除版本可用它互相关联 |
| `event_type` | `text` | 是 | 事件类型：`create`、`update`、`delete` 或 `manual_test` |
| `guild_id` | `text` | 否 | 来源服务器 ID；手工测试可能为空 |
| `channel_id` | `text` | 是 | 来源频道 ID；手工测试使用内部测试标识 |
| `author_id` | `text` | 否 | 原消息发布者 ID；删除事件或手工测试可能无法提供 |
| `content` | `text` | 是 | 当次事件可取得的原始文字；删除事件可能为空 |
| `discord_created_at` | `timestamptz` | 否 | Discord 侧显示的消息创建时间 |
| `received_at` | `timestamptz` | 是 | 本系统收到并记录该事件的时间 |
| `raw_payload` | `jsonb` | 是 | 附件、Embed 等需要保留但未拆列的原始信息 |

常用时间差：`received_at - discord_created_at` 是 Discord 到采集服务的接收延迟。它不等于最终模拟成交延迟。

### `event_type` 状态

| 值 | 含义 |
|---|---|
| `create` | 新消息创建 |
| `update` | 原消息被编辑；必须新增一行 |
| `delete` | 原消息被删除；必须保留删除事件 |
| `manual_test` | 本地烟雾测试，不是 Discord 正式消息 |

## 7. `signal_interpretations`：候选信号解析

一行表示某个解析器对一次消息事件的一次理解。同一原始消息可以有多个版本，例如旧规则解释被安全修正后，再追加一个新版本。

| 字段 | 类型 | 是否必填 | 含义 |
|---|---|---:|---|
| `id` | `uuid` | 是 | 候选解析唯一编号 |
| `message_event_id` | `uuid` | 否 | 对应 `discord_message_events.id`；用于追溯原文 |
| `parser_name` | `text` | 是 | 解析器名称，例如规则解析器或 AI 解析器 |
| `parser_version` | `text` | 是 | 解析器/规则版本，例如 `rules-v1.1` |
| `symbol` | `text` | 否 | 识别出的股票代码，例如 `NVDA`；未知时为空 |
| `action` | `text` | 是 | 候选动作：`buy`、`sell`、`hold` 或 `note` |
| `reference_price` | `numeric(20,6)` | 否 | 消息中提到的参考价，不一定是实时行情或成交价 |
| `position_fraction` | `numeric(10,8)` | 否 | 仓位比例；`0.5` 表示半仓，`0.33333333` 约表示三分之一 |
| `stop_price` | `numeric(20,6)` | 否 | 指令中明确给出的止损/触发价格 |
| `is_conditional` | `boolean` | 是 | 是否带“如果、突破、跌破、到价再”等条件 |
| `confidence` | `numeric(8,6)` | 是 | 结构解析完整度，范围 0–1；不是盈利概率 |
| `is_executable` | `boolean` | 是 | 结构是否足够进入后续候选流程；不代表已通过风控或已成交 |
| `reasons` | `text[]` | 是 | 不完整、歧义或不可执行的具体原因列表 |
| `status` | `text` | 是 | 当前审核/模拟状态，见下表 |
| `parsed_payload` | `jsonb` | 是 | 完整结构化结果，包括 `ambiguous` 等扩展安全字段 |
| `created_at` | `timestamptz` | 是 | 本次解析创建时间 |

### `action` 状态

| 值 | 含义 |
|---|---|
| `buy` | 买入或加仓候选 |
| `sell` | 卖出、减仓或止盈候选 |
| `hold` | 持有、等待或暂不操作 |
| `note` | 普通观点/信息，不能形成交易候选 |

### `status` 状态

| 值 | 含义 |
|---|---|
| `pending_review` | 等待人工查看 |
| `confirmed` | 人工确认了候选含义，但还不等于成交 |
| `ignored` | 选择忽略，不进入模拟订单 |
| `rejected` | 明确判定为错误、过期或不安全 |
| `simulated` | 已进入模拟交易流程 |

### `ambiguous` 在哪里

当前数据库没有单独的 `ambiguous` 列，它位于 `parsed_payload` JSON 中。PostgreSQL 查询写法：

```sql
select id,
       parsed_payload ->> 'ambiguous' as ambiguous,
       is_executable,
       reasons
from signal_interpretations
order by created_at desc;
```

网页 API 会把它展开为顶层驼峰字段 `ambiguous`。同一消息出现多个交易动作、多个股票代码或未验证股票标识时，应为 `true`，同时 `is_executable=false`。

## 8. `review_decisions`：人工审核决定

一行表示一次人工或系统安全审核。重复审核时追加记录，不覆盖先前决定。

| 字段 | 类型 | 是否必填 | 含义 |
|---|---|---:|---|
| `id` | `uuid` | 是 | 审核记录唯一编号 |
| `signal_id` | `uuid` | 是 | 对应 `signal_interpretations.id` |
| `decision` | `text` | 是 | `confirm`、`ignore`、`reject` 或 `edit` |
| `reviewer` | `text` | 是 | 审核者标识；可以是用户或明确命名的系统安全修正流程 |
| `reason` | `text` | 否 | 为什么作出此决定 |
| `edited_payload` | `jsonb` | 否 | `edit` 时保存人工修正后的候选结构 |
| `created_at` | `timestamptz` | 是 | 决定发生时间 |

### `decision` 状态

| 值 | 含义 |
|---|---|
| `confirm` | 确认解析含义，可继续做模拟风控 |
| `ignore` | 暂不处理，通常表示信息价值低或无需交易 |
| `reject` | 明确驳回错误、不安全或失效的候选 |
| `edit` | 原解析不完全正确，人工修改后再进入后续流程 |

## 9. `market_quotes`：行情快照

一行表示一个股票在某行情时点的一条报价。未来接入长桥时，必须同时保留行情本身的时间和系统收到它的时间。

| 字段 | 类型 | 是否必填 | 含义 |
|---|---|---:|---|
| `id` | `uuid` | 是 | 行情记录唯一编号 |
| `symbol` | `text` | 是 | 标准化股票代码 |
| `source` | `text` | 是 | 行情来源，例如未来的长桥行情适配器 |
| `bid` | `numeric(20,6)` | 否 | 当前最高买价 |
| `ask` | `numeric(20,6)` | 否 | 当前最低卖价 |
| `last_price` | `numeric(20,6)` | 否 | 最近成交价 |
| `quote_time` | `timestamptz` | 是 | 行情源标注的市场数据时间 |
| `received_at` | `timestamptz` | 是 | 本系统实际收到行情的时间 |
| `raw_payload` | `jsonb` | 是 | 行情源原始返回，供审计和字段升级使用 |

`reference_price`、`last_price` 和 `fill_price` 是三个不同口径：频道说的价格、市场行情价格、模拟成交价格，不能混用。

## 10. `paper_orders`：模拟订单

一行表示一张模拟订单。它保存的是系统准备如何模拟买卖，不是真实券商订单。

| 字段 | 类型 | 是否必填 | 含义 |
|---|---|---:|---|
| `id` | `uuid` | 是 | 模拟订单唯一编号 |
| `portfolio_id` | `uuid` | 是 | 对应 `portfolios.id` |
| `signal_id` | `uuid` | 否 | 来源候选信号；手工模拟单未来可为空 |
| `symbol` | `text` | 是 | 股票代码 |
| `side` | `text` | 是 | `buy` 或 `sell` |
| `order_type` | `text` | 是 | `market`、`limit` 或 `stop` |
| `quantity` | `numeric(20,6)` | 是 | 计划交易数量，必须大于 0 |
| `limit_price` | `numeric(20,6)` | 否 | 限价；市价单通常为空 |
| `status` | `text` | 是 | 订单生命周期状态，见下表 |
| `risk_snapshot` | `jsonb` | 是 | 创建订单时的权益、现金、集中度、时延和拦截原因快照 |
| `created_at` | `timestamptz` | 是 | 订单创建时间 |
| `updated_at` | `timestamptz` | 是 | 订单最近状态更新时间 |

### `paper_orders.status`

| 值 | 含义 |
|---|---|
| `created` | 已创建，尚未完成风控判定 |
| `eligible` | 满足当前模拟风控条件 |
| `blocked` | 被资金、集中度、时延、持仓或其他规则拦截 |
| `filled` | 已完全模拟成交 |
| `cancelled` | 已取消 |
| `expired` | 因时间或条件失效 |

## 11. `paper_fills`：模拟成交

一行表示一次模拟成交。一张订单未来可能分成多笔成交，因此 `paper_orders` 与 `paper_fills` 是一对多关系。

| 字段 | 类型 | 是否必填 | 含义 |
|---|---|---:|---|
| `id` | `uuid` | 是 | 模拟成交唯一编号 |
| `order_id` | `uuid` | 是 | 对应 `paper_orders.id` |
| `quantity` | `numeric(20,6)` | 是 | 本次成交数量，必须大于 0 |
| `signal_price` | `numeric(20,6)` | 否 | 信号参考价，用于对照 |
| `fill_price` | `numeric(20,6)` | 是 | 按既定假设得到的模拟成交价 |
| `fees` | `numeric(20,6)` | 是 | 模拟手续费及已纳入口径的费用 |
| `slippage_bps` | `numeric(20,6)` | 否 | 相对信号价或基准价的滑点，单位为基点；100 bps = 1% |
| `signal_to_fill_ms` | `bigint` | 否 | 从信号时间到模拟成交时间的毫秒数 |
| `filled_at` | `timestamptz` | 是 | 模拟成交时间 |
| `fill_method` | `text` | 是 | 成交模型/方法名称，便于以后比较不同假设 |
| `assumptions` | `jsonb` | 是 | 点差、延迟、行情选择、部分成交等假设 |

“可执行模拟收益”必须使用 `fill_price`、`fees` 和真实可取得的行情，不应只用频道给出的 `signal_price`。

## 12. `position_snapshots`：持仓快照

一行表示一个组合中某股票在某时点的持仓状态。快照是历史记录，不应只保留最新一行。

| 字段 | 类型 | 是否必填 | 含义 |
|---|---|---:|---|
| `id` | `uuid` | 是 | 快照唯一编号 |
| `portfolio_id` | `uuid` | 是 | 对应 `portfolios.id` |
| `symbol` | `text` | 是 | 股票代码 |
| `quantity` | `numeric(20,6)` | 是 | 当时持仓数量；0 可表示已经清仓后的状态 |
| `average_cost` | `numeric(20,6)` | 否 | 当时平均持仓成本 |
| `last_price` | `numeric(20,6)` | 否 | 生成快照时采用的最新市场价 |
| `market_value` | `numeric(20,6)` | 是 | 持仓市值，通常为数量乘最新价 |
| `unrealized_pnl` | `numeric(20,6)` | 否 | 未实现盈亏，即尚未卖出部分的账面盈亏 |
| `realized_pnl` | `numeric(20,6)` | 否 | 截至该时点已经通过卖出实现的累计盈亏 |
| `captured_at` | `timestamptz` | 是 | 快照时间 |

网页展示“当前持仓”时，应对每个 `portfolio_id + symbol` 选择最新 `captured_at`，不能把所有历史快照数量相加。

## 13. `audit_events`：审计事件

一行记录一次重要行为。它回答“谁在什么时候对什么做了什么，以及为什么”。

| 字段 | 类型 | 是否必填 | 含义 |
|---|---|---:|---|
| `id` | `uuid` | 是 | 审计事件唯一编号 |
| `actor_type` | `text` | 是 | 行为者类别，例如 `system`、`user`、`parser` |
| `actor_id` | `text` | 否 | 更具体的行为者或规则版本标识 |
| `action` | `text` | 是 | 行为名称，应使用稳定、可搜索的机器可读名称 |
| `entity_type` | `text` | 是 | 被操作对象类型，例如 `signal_interpretation` |
| `entity_id` | `text` | 否 | 被操作对象编号；使用文字可兼容 UUID 和外部 ID |
| `details` | `jsonb` | 是 | 原因、旧新值、关联对象等补充信息 |
| `created_at` | `timestamptz` | 是 | 行为发生时间 |

审计表不是应用调试日志。普通启动信息不必写入；安全修正、权限/规则变化、异常回补和人工关键操作应写入。

## 14. `schema_migrations`：数据库版本记录

此表由迁移器管理。一行代表一个迁移 SQL 文件已经成功执行。

| 字段 | 常见类型 | 含义 |
|---|---|---|
| `name` | `text` | 迁移文件名或迁移唯一名称，例如 `001_initial_schema.sql` |
| `applied_at` | `timestamptz` | 迁移成功完成时间 |

不要手工删除或修改这里的记录。数据库结构升级必须在 `db/migrations/` 新增迁移文件，禁止修改已经执行过的旧迁移。

## 15. 关键表之间如何关联

| 父表字段 | 子表字段 | 关系 |
|---|---|---|
| `discord_message_events.id` | `signal_interpretations.message_event_id` | 一次原始事件可以产生多个版本的候选解析 |
| `signal_interpretations.id` | `review_decisions.signal_id` | 一个候选可以有多次审核记录 |
| `signal_interpretations.id` | `paper_orders.signal_id` | 一个候选可生成模拟订单；当前业务通常限制为可审计流程 |
| `portfolios.id` | `paper_orders.portfolio_id` | 一个组合可以有多张模拟订单 |
| `paper_orders.id` | `paper_fills.order_id` | 一张模拟订单可以有多笔模拟成交 |
| `portfolios.id` | `position_snapshots.portfolio_id` | 一个组合可以有多只股票、多个时间点的持仓快照 |

`audit_events.entity_id` 是通用文字关联，没有数据库外键；这是为了让它能记录不同类型对象。查询时必须同时看 `entity_type`。

## 16. 数据库字段与网页 API 字段

数据库使用下划线命名，网页 REST/SSE 使用驼峰命名。两者含义相同，但名称形式不同。

| 数据库字段 | 网页/API 字段 |
|---|---|
| `message_event_id` | `messageEventId` |
| `discord_message_id` | `messageId` |
| `discord_created_at` | `discordCreatedAt` |
| `received_at` | `recordedAt` 或具体接口定义的接收时间 |
| `reference_price` | `price` |
| `position_fraction` | `fraction` |
| `stop_price` | `stopPrice` |
| `is_conditional` | `conditional` |
| `is_executable` | `executable` |
| `parsed_payload.ambiguous` | `ambiguous` |
| `current_cash` | `cash` |
| `current_equity` | `equity` |
| `max_gross_utilization` | `maxGrossUtilization` |
| `max_symbol_weight` | `maxSymbolWeight` |
| `min_cash_reserve` | `minCashReserve` |

内存演示仓库和 PostgreSQL 仓库必须输出相同的公共 API 结构。网页里看到的字段不能反向假定数据库列名完全一致。

## 17. 核心计算口径

### 资金利用率

```text
资金利用率 = 当前全部持仓市值绝对值合计 ÷ 当前账户权益
```

空仓时为 0。未来支持空头后使用绝对值，可以避免多空抵消掩盖总风险。

### 单一股票权重

```text
单一股票权重 = 该股票持仓市值绝对值 ÷ 当前账户权益
```

默认不应超过 `portfolios.max_symbol_weight`。

### 未实现盈亏

```text
未实现盈亏 = (最新价 - 平均成本) × 当前持仓数量
```

这是多头基础口径；如果未来支持空头，需要单独验证符号方向。

### 理论信号收益与可执行模拟收益

- 理论信号收益：使用频道文字中的参考价格，仅用于复盘“理想情况下”。
- 可执行模拟收益：使用消息到达后真实可获得的行情、模拟成交价、滑点、费用和延迟。
- 两者必须分开展示，不能把理论最高点收益当成实际可跟单收益。

### 解析置信度

`confidence` 只表示解析结构是否完整、明确，不表示这笔交易上涨或赚钱的概率。

## 18. Navicat 常用只读查询

以下 SQL 只查询数据，不修改数据库。

### 最近 50 条 Discord 事件

```sql
select event_type,
       content,
       discord_created_at,
       received_at,
       received_at - discord_created_at as receive_delay
from discord_message_events
order by received_at desc
limit 50;
```

### 原始消息与候选解析一起看

```sql
select m.received_at,
       m.event_type,
       m.content,
       s.parser_version,
       s.symbol,
       s.action,
       s.reference_price,
       s.position_fraction,
       s.confidence,
       s.is_executable,
       s.parsed_payload ->> 'ambiguous' as ambiguous,
       s.status,
       s.reasons
from discord_message_events m
left join signal_interpretations s
  on s.message_event_id = m.id
order by m.received_at desc, s.created_at desc
limit 100;
```

### 查看等待人工审核的候选

```sql
select s.created_at,
       m.content,
       s.symbol,
       s.action,
       s.reference_price,
       s.position_fraction,
       s.confidence,
       s.is_executable,
       s.reasons
from signal_interpretations s
left join discord_message_events m
  on m.id = s.message_event_id
where s.status = 'pending_review'
order by s.created_at desc;
```

### 查看每只股票最新持仓

```sql
select distinct on (portfolio_id, symbol)
       portfolio_id,
       symbol,
       quantity,
       average_cost,
       last_price,
       market_value,
       unrealized_pnl,
       realized_pnl,
       captured_at
from position_snapshots
order by portfolio_id, symbol, captured_at desc;
```

### 查看模拟订单和成交

```sql
select o.created_at,
       o.symbol,
       o.side,
       o.order_type,
       o.quantity as order_quantity,
       o.status,
       f.quantity as fill_quantity,
       f.signal_price,
       f.fill_price,
       f.fees,
       f.slippage_bps,
       f.signal_to_fill_ms,
       f.filled_at
from paper_orders o
left join paper_fills f
  on f.order_id = o.id
order by o.created_at desc, f.filled_at desc;
```

### 查看最近审计记录

```sql
select created_at,
       actor_type,
       actor_id,
       action,
       entity_type,
       entity_id,
       details
from audit_events
order by created_at desc
limit 100;
```

### 检查每张表有多少行

```sql
select 'portfolios' as table_name, count(*) as row_count from portfolios
union all select 'discord_subscriptions', count(*) from discord_subscriptions
union all select 'discord_message_events', count(*) from discord_message_events
union all select 'signal_interpretations', count(*) from signal_interpretations
union all select 'review_decisions', count(*) from review_decisions
union all select 'market_quotes', count(*) from market_quotes
union all select 'paper_orders', count(*) from paper_orders
union all select 'paper_fills', count(*) from paper_fills
union all select 'position_snapshots', count(*) from position_snapshots
union all select 'audit_events', count(*) from audit_events
union all select 'schema_migrations', count(*) from schema_migrations
order by table_name;
```

## 19. 查看数据时最容易误解的地方

1. `is_executable=true` 不等于可以自动成交，只表示候选结构较完整；仍需风控和人工确认。
2. `confidence=1` 不等于 100% 会赚钱，只表示解析器认为文字结构明确。
3. `reference_price` 是频道里的参考价，不一定是市场实时价。
4. 一条 Discord 消息可能对应多条事件和多个解析版本，不能只取任意一行。
5. 删除消息不会从数据库抹掉原文；系统追加 `delete` 事件用于审计。
6. `position_snapshots` 是历史快照，查看当前仓位要取每只股票最新一条。
7. 空的行情、订单、成交和持仓表不代表故障；当前这些模块还在路线图中。
8. GitHub Pages 是静态演示，不会公开本机 PostgreSQL 数据。
9. `jsonb` 中的原始载荷可能含频道文字，数据库备份不得上传公开 GitHub。
10. Navicat 日常只使用只读账号；遇到 `25006` 表示写入被正确阻止。

## 20. 维护规则

- 原始 Discord 事件只追加，不覆盖、不删除。
- 数据库结构变化必须新增迁移文件，并同步更新本文。
- 解析器、规则、AI 模型和成交方法必须保存版本。
- AI 结果始终是未受信任候选，必须通过确定性校验和人工确认。
- 所有资金、持仓和收益必须能追溯到原始消息、行情时点、审核决定和成交假设。
- 任何密码、Token、真实连接串和数据库备份都不得进入 Git。
