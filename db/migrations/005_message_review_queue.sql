create table message_review_decisions (
  id uuid primary key default gen_random_uuid(),
  message_event_id uuid not null references discord_message_events(id),
  decision text not null check (decision in ('confirm','ignore')),
  reviewer text not null,
  reason text,
  created_at timestamptz not null default now()
);

create index message_review_decisions_message_time_idx
  on message_review_decisions (message_event_id, created_at desc);

comment on table message_review_decisions is
  'Append-only acknowledgement queue for raw Discord messages that deterministic parsing cannot safely interpret.';
