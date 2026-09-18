create extension if not exists pgcrypto;

create table portfolios (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  base_currency text not null default 'USD',
  initial_capital numeric(20,4) not null check (initial_capital > 0),
  current_cash numeric(20,4) not null,
  current_equity numeric(20,4) not null,
  max_gross_utilization numeric(8,6) not null default 0.70,
  max_symbol_weight numeric(8,6) not null default 0.20,
  min_cash_reserve numeric(8,6) not null default 0.30,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table discord_message_events (
  id uuid primary key default gen_random_uuid(),
  discord_message_id text,
  event_type text not null check (event_type in ('create','update','delete','manual_test')),
  guild_id text,
  channel_id text not null,
  author_id text,
  content text not null default '',
  discord_created_at timestamptz,
  received_at timestamptz not null default now(),
  raw_payload jsonb not null default '{}'::jsonb
);
create index discord_message_events_message_idx on discord_message_events (discord_message_id, received_at);
create index discord_message_events_channel_idx on discord_message_events (channel_id, received_at desc);

create table signal_interpretations (
  id uuid primary key default gen_random_uuid(),
  message_event_id uuid references discord_message_events(id),
  parser_name text not null,
  parser_version text not null,
  symbol text,
  action text not null check (action in ('buy','sell','hold','note')),
  reference_price numeric(20,6),
  position_fraction numeric(10,8),
  stop_price numeric(20,6),
  is_conditional boolean not null default false,
  confidence numeric(8,6) not null check (confidence between 0 and 1),
  is_executable boolean not null default false,
  reasons text[] not null default '{}',
  status text not null check (status in ('pending_review','confirmed','ignored','rejected','simulated')),
  parsed_payload jsonb not null,
  created_at timestamptz not null default now()
);

create table review_decisions (
  id uuid primary key default gen_random_uuid(),
  signal_id uuid not null references signal_interpretations(id),
  decision text not null check (decision in ('confirm','ignore','reject','edit')),
  reviewer text not null,
  reason text,
  edited_payload jsonb,
  created_at timestamptz not null default now()
);

create table market_quotes (
  id uuid primary key default gen_random_uuid(),
  symbol text not null,
  source text not null,
  bid numeric(20,6),
  ask numeric(20,6),
  last_price numeric(20,6),
  quote_time timestamptz not null,
  received_at timestamptz not null default now(),
  raw_payload jsonb not null default '{}'::jsonb
);
create index market_quotes_symbol_time_idx on market_quotes (symbol, quote_time desc);

create table paper_orders (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null references portfolios(id),
  signal_id uuid references signal_interpretations(id),
  symbol text not null,
  side text not null check (side in ('buy','sell')),
  order_type text not null check (order_type in ('market','limit','stop')),
  quantity numeric(20,6) not null check (quantity > 0),
  limit_price numeric(20,6),
  status text not null check (status in ('created','eligible','blocked','filled','cancelled','expired')),
  risk_snapshot jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table paper_fills (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references paper_orders(id),
  quantity numeric(20,6) not null check (quantity > 0),
  signal_price numeric(20,6),
  fill_price numeric(20,6) not null,
  fees numeric(20,6) not null default 0,
  slippage_bps numeric(20,6),
  signal_to_fill_ms bigint,
  filled_at timestamptz not null,
  fill_method text not null,
  assumptions jsonb not null default '{}'::jsonb
);

create table position_snapshots (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null references portfolios(id),
  symbol text not null,
  quantity numeric(20,6) not null,
  average_cost numeric(20,6),
  last_price numeric(20,6),
  market_value numeric(20,6) not null,
  unrealized_pnl numeric(20,6),
  realized_pnl numeric(20,6),
  captured_at timestamptz not null default now()
);
create index position_snapshots_portfolio_time_idx on position_snapshots (portfolio_id, captured_at desc);

create table audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_type text not null,
  actor_id text,
  action text not null,
  entity_type text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_events_time_idx on audit_events (created_at desc);

insert into portfolios (name, initial_capital, current_cash, current_equity)
select '默认模拟组合', 1000000, 1000000, 1000000
where not exists (select 1 from portfolios);
