create table strategy_replay_runs (
  id uuid primary key default gen_random_uuid(),
  history_import_id uuid not null references discord_history_imports(id),
  strategy_version text not null,
  status text not null check (status in ('running','completed','failed')),
  period_start timestamptz not null,
  period_end timestamptz not null,
  initial_capital numeric(20,6) not null,
  final_equity numeric(20,6),
  cash numeric(20,6),
  market_value numeric(20,6),
  realized_pnl numeric(20,6),
  unrealized_pnl numeric(20,6),
  total_return_pct numeric(20,8),
  max_drawdown_pct numeric(20,8),
  peak_utilization_pct numeric(20,8),
  assumptions jsonb not null,
  metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index strategy_replay_runs_completed_idx on strategy_replay_runs (completed_at desc)
  where status = 'completed';

create table strategy_replay_events (
  id bigserial primary key,
  run_id uuid not null references strategy_replay_runs(id) on delete cascade,
  sequence integer not null,
  trade_leg_id uuid references strategy_trade_legs(id),
  message_event_id uuid references discord_message_events(id),
  occurred_at timestamptz not null,
  side text not null check (side in ('buy','sell','skipped')),
  symbol text not null,
  quantity numeric(20,6) not null default 0,
  signal_price numeric(20,6),
  fill_price numeric(20,6),
  fees numeric(20,6) not null default 0,
  realized_pnl numeric(20,6) not null default 0,
  cash_after numeric(20,6),
  equity_after numeric(20,6),
  utilization_pct numeric(20,8),
  status text not null check (status in ('filled','skipped_unmatched','skipped_review','skipped_risk')),
  reason text,
  unique (run_id, sequence)
);

create index strategy_replay_events_run_time_idx on strategy_replay_events (run_id, occurred_at desc);

create table strategy_replay_snapshots (
  id bigserial primary key,
  run_id uuid not null references strategy_replay_runs(id) on delete cascade,
  sequence integer not null,
  occurred_at timestamptz not null,
  cash numeric(20,6) not null,
  market_value numeric(20,6) not null,
  equity numeric(20,6) not null,
  return_pct numeric(20,8) not null,
  drawdown_pct numeric(20,8) not null,
  event_side text,
  event_symbol text,
  mark_source text,
  unique (run_id, sequence)
);

create index strategy_replay_snapshots_run_time_idx on strategy_replay_snapshots (run_id, occurred_at);

create table strategy_replay_positions (
  id bigserial primary key,
  run_id uuid not null references strategy_replay_runs(id) on delete cascade,
  symbol text not null,
  quantity numeric(20,6) not null,
  average_cost numeric(20,6) not null,
  mark_price numeric(20,6) not null,
  market_value numeric(20,6) not null,
  unrealized_pnl numeric(20,6) not null,
  mark_source text not null check (mark_source in ('longbridge','last_signal')),
  unique (run_id, symbol)
);

comment on table strategy_replay_runs is
  'Versioned finite-capital paper replays. These are model estimates, not broker account returns.';
comment on table strategy_replay_events is
  'Filled and skipped replay decisions with signal price, modeled fill, fees and account state.';
comment on table strategy_replay_snapshots is
  'Event-time equity curve. Between signal events, unmentioned symbols carry their last observed mark.';

