create table discord_subscriptions (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null,
  channel_id text not null,
  author_id text,
  label text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index discord_subscriptions_scope_uniq
  on discord_subscriptions (guild_id, channel_id, coalesce(author_id, ''));

create index discord_subscriptions_active_idx
  on discord_subscriptions (guild_id, channel_id, author_id)
  where enabled = true;

comment on column discord_subscriptions.author_id is
  'Null means listen to every non-bot author in this channel.';
