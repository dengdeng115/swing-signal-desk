# 运行手册

## 本机演示后端

```powershell
npm ci
Copy-Item .env.example .env
npm start
```

访问 `http://localhost:8787`，健康检查为 `http://localhost:8787/api/health`。默认使用内存数据，重启即清空。

### Windows 登录后自动运行

已配置 `.env` 和 PostgreSQL 后，执行一次：

```powershell
npm run service:install
npm run service:status
```

任务名为 `Swing Signal Desk`，在当前 Windows 用户登录时以隐藏窗口启动 `scripts/start-local.ps1`。任务文件不保存 Token 或数据库密码，服务仍从项目目录下被 Git 忽略的 `.env` 读取。安装任务不会立即启动第二个实例；当前已有服务时继续使用当前进程，下次登录自动接管。

### 桌面 App 入口

```powershell
npm run desktop:install
```

该命令在当前用户桌面创建“波段信号台”快捷方式，并直接用 Edge、其次 Chrome 的 `--app` 独立窗口打开仪表盘。直接指向浏览器可避免 Windows 清理脚本型桌面快捷方式；本机后端由登录自启任务维护。若服务被手动关闭，可运行 `npm run desktop:open`，此时 `scripts/launch-app.ps1` 会先检查 `http://localhost:8787/api/health`，必要时隐藏启动服务并等待约 10 秒。它不是 Electron，不复制数据库和密钥，更新代码后无需重新打包 App。

网页同时提供 Web App Manifest 与 Service Worker。在支持 PWA 的 Edge/Chrome 中出现“安装桌面版”按钮时也可安装；Service Worker 只缓存同源静态外壳，不缓存 `/api/` 数据，实时数据始终从本机后端读取。

## PostgreSQL 初始化

本机 PostgreSQL 已完成初始化。详细的角色、Navicat、迁移、验证和故障排查见 `docs/POSTGRES_SETUP.md`。不要把密码发到聊天或提交到 GitHub。

```powershell
npm run db:migrate
npm run db:verify
npm start
```

健康检查必须显示 `storage: postgres` 与 `database: swing_signal_desk`。应用使用 `swing_signal_app`；Navicat 日常查看使用 `swing_signal_readonly`，不要长期使用 `postgres` 超级用户。

## 一个月历史回补

历史源文件保存在被 Git 忽略的 `server/data/stockrocks-last-month.json`，不得上传公开仓库。先执行迁移，再导入：

```powershell
npm run db:migrate
npm run db:import-history
npm run db:verify
```

导入以源文件 SHA-256 和 Discord Message ID 防重；重复执行应返回 `idempotent: true`。网页的胜率只使用 `strategy_trade_legs.analysis_included=true` 的严格、非重复、已完成交易腿。新增或修正解析规则时必须使用新的 `parser_version`，不能覆盖旧结果。

## 长桥行情参考

本地后端的 `/api/market/quotes?symbols=NVDA,AMD` 通过已安装的长桥 CLI 只读查询报价，最多接受 20 个合法美股代码并缓存 30 秒。网页应显示读取时间和盘前/盘后标签。该接口不下单，也不得用当前报价替换频道的历史进出价。

## 有限资金历史回放

```powershell
npm run db:replay
```

该命令读取最近一次已完成的 Discord 历史导入和 `strategy_trade_legs`，按 `finite-capital-v1` 生成一个新的、不可覆盖的回放版本。默认口径：

- 起始现金 1,000,000 USD；不虚构窗口开始前的持仓。
- 新买入时总持仓不超过当时权益 70%，单标的不超过 12%。
- “六分之一常规仓”按当时权益约 2% 计算；加回优先复用最近卖出股数。
- 买卖各计 10 bps 滑点和 2 bps 费用。
- 卖单必须匹配本月相同标的和明确成本价的买入批次；未匹配卖单记录为跳过。
- 事件间沿用最近信号价，最后用长桥当前报价标记仍持有的股票。

回放完成后，`/api/dashboard` 的 `accountReplay` 会提供汇总、曲线、逐笔处理记录和期末持仓。静态公开页只嵌入聚合曲线，不包含付费频道原文、逐笔流水或持仓明细。

每次回放还会用完全相同的信号、仓位与期末报价计算三档成交成本：`5+1 bps` 理想成交、`10+2 bps` 当前模型、`30+5 bps` 延迟压力。结果写入 `strategy_replay_runs.metrics.scenarios`。网页上的卖单可匹配率用于披露统计窗口对期初仓位的覆盖程度，不能当成解析准确率。三档成本压力测试固定使用完整历史回放，不随周/月子周期切换。

本机网页“算法跟单买卖流水”右上角可导出完整 UTF-8 CSV。导出包含所有成交与跳过记录，不只包含当前筛选和当前显示的 50 条；公开 GitHub Pages 因没有逐笔数据而禁用该按钮。

注意：这是实时记录加确定性纸面回放，不是真实自动交易。Discord 新消息仍先进入 `pending_review`；模糊消息不生成自动模拟成交，未来接入 AI 或前向模拟时也必须保留人工确认闸门。

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

### 实时更新与漏消息补扫

- Gateway：Bot 在线时由 Discord 推送新消息，通常秒级进入数据库。
- 定时补扫：服务器默认每 60 秒按订阅扫描一次历史，最多回看 1000 条；按 Discord Message ID 幂等写入，不重复记账。
- 页面打开：本机网页首次加载会主动调用 `/api/discord/sync`；若 30 秒内已经扫过则节流，避免反复请求 Discord。
- 页面刷新：数据库或回放变化通过 SSE 推到已打开页面；浏览器另外每 30 秒拉取一次仪表盘作为断线兜底。
- 组合刷新：新的严格策略腿写入后约 5 秒合并触发一次新版回放；原始消息立即可见，收益曲线在回放完成后更新。

可用环境变量调整 `DISCORD_CATCHUP_INTERVAL_SECONDS`、`DISCORD_CATCHUP_MIN_GAP_SECONDS` 与 `DISCORD_CATCHUP_MAX_MESSAGES`。公开 GitHub Pages 没有后端和密钥，不能发起 Discord 扫描，只显示最近一次提交的脱敏统计快照。

`DISCORD_SUBSCRIPTIONS_JSON` 中每项包含 `guildId`、`channelId` 和 `authorIds`；`authorIds` 可包含多人，空数组表示监听该频道全部非 Bot 发布者。若频道消息由转发 Bot 发布，只有把该 Bot 的准确用户 ID 明确写入 `authorIds` 才会接收；通配订阅不会接收 Bot，采集器也永远忽略自身消息。采集器逐条匹配订阅，不会把不同频道和作者交叉组合。

首次启用后先在测试频道发送一条新消息，再编辑并删除；逐条核对原文、编辑记录、接收延迟和解析结果。确认无误后才切换到正式频道。

## AI 接入

设置 `AI_ENABLED=true`、`OPENAI_API_KEY`、`OPENAI_MODEL`。AI 只在规则结果不完整或置信度不足时调用；上线前需用真实历史样本做离线评测。
