create table discord_history_imports (
  id uuid primary key default gen_random_uuid(),
  source_label text not null,
  source_file_hash text not null unique,
  period_start timestamptz not null,
  period_end timestamptz not null,
  status text not null check (status in ('running','completed','failed')),
  fetched_count integer not null default 0,
  imported_count integer not null default 0,
  details jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table discord_message_events
  add column ingestion_mode text not null default 'realtime'
    check (ingestion_mode in ('realtime','historical_backfill','manual_test')),
  add column history_import_id uuid references discord_history_imports(id),
  add column source_fetched_at timestamptz;

update discord_message_events set ingestion_mode = 'manual_test' where event_type = 'manual_test';

create unique index discord_message_create_unique_idx
  on discord_message_events (discord_message_id)
  where event_type = 'create' and discord_message_id is not null;

create table strategy_trade_legs (
  id uuid primary key default gen_random_uuid(),
  message_event_id uuid not null references discord_message_events(id),
  leg_index integer not null check (leg_index >= 0),
  parser_version text not null,
  extraction_method text not null,
  action text not null check (action in ('buy','rebuy','sell')),
  symbol text not null,
  entry_price numeric(20,6) not null check (entry_price > 0),
  exit_price numeric(20,6),
  position_fraction numeric(10,8),
  is_closed_leg boolean not null default false,
  gross_return_pct numeric(20,8),
  outcome text not null check (outcome in ('win','loss','flat','open')),
  confidence numeric(8,6) not null check (confidence between 0 and 1),
  review_status text not null check (review_status in ('auto_included','needs_review','excluded_duplicate')),
  analysis_included boolean not null default false,
  duplicate_of_message_id text,
  notes text,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (message_event_id, leg_index, parser_version),
  check ((is_closed_leg and exit_price is not null and gross_return_pct is not null and outcome <> 'open')
      or (not is_closed_leg and exit_price is null and gross_return_pct is null and outcome = 'open'))
);

create index strategy_trade_legs_period_idx on strategy_trade_legs (occurred_at desc);
create index strategy_trade_legs_symbol_idx on strategy_trade_legs (symbol, occurred_at desc);
create index strategy_trade_legs_included_idx on strategy_trade_legs (occurred_at desc)
  where analysis_included = true;

comment on table strategy_trade_legs is
  'Auditable signal-level operations extracted from Discord history; returns are theoretical per-leg returns, not portfolio returns.';
