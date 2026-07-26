-- Run this in the Supabase SQL editor (fresh project or migrate onto existing).

create table if not exists runs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  sports text[] not null,
  match_count int not null default 0,
  status text not null default 'complete'
);

create table if not exists matches (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references runs(id) on delete cascade,
  event_id text,
  sport text not null,
  league text,
  home_team text not null,
  away_team text not null,
  commence_time timestamptz not null,
  market text not null,
  pick_selection text not null,
  best_price numeric not null,
  book text,
  num_books int not null default 1,
  price_spread numeric,
  implied_prob numeric not null,
  confidence_score numeric not null,
  confidence_band text not null,
  result text not null default 'pending', -- pending | won | lost | void
  profit numeric,
  raw jsonb,
  created_at timestamptz not null default now()
);

create table if not exists combinations (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references runs(id) on delete cascade,
  tier text not null,
  target_odds numeric not null,
  combined_odds numeric not null,
  implied_probability numeric not null,
  leg_count int not null,
  match_ids uuid[] not null,
  created_at timestamptz not null default now()
);

-- Idempotent upgrades for existing projects
alter table matches add column if not exists event_id text;
alter table matches add column if not exists result text default 'pending';
alter table matches add column if not exists profit numeric;

create index if not exists idx_matches_run_id on matches(run_id);
create index if not exists idx_combinations_run_id on combinations(run_id);
create index if not exists idx_matches_event_id on matches(event_id);
create index if not exists idx_matches_result_commence on matches(result, commence_time desc);
