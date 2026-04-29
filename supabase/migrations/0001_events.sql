-- =====================================================================
-- Vibe Check telemetry — events table
--
-- Run this once against a fresh Supabase project (SQL editor → New query).
-- Then grab the project's anon key and URL from Project Settings → API
-- and embed them in src/telemetry/Telemetry.ts (or set the matching env
-- vars at build time via esbuild's `define`).
--
-- Security model: the extension ships with the anon key. Row Level
-- Security on this table allows INSERT only — even with the anon key, no
-- one can SELECT, UPDATE, or DELETE. The dashboard uses a separate
-- service-role key kept locally and never embedded in the extension.
-- =====================================================================

create extension if not exists pgcrypto;

create table if not exists public.events (
  id              bigserial primary key,
  received_at     timestamptz not null default now(),
  client_ts       timestamptz not null,
  anon_id         text not null,
  session_id      text not null,
  host            text not null,
  app_name        text,
  app_version     text,
  ext_version     text not null,
  os              text,
  schema_version  int  not null default 1,
  name            text not null,
  props           jsonb not null default '{}'::jsonb
);

-- Indexes for the dashboard's query patterns.
create index if not exists events_received_at_idx on public.events (received_at desc);
create index if not exists events_name_idx        on public.events (name);
create index if not exists events_anon_idx        on public.events (anon_id);
create index if not exists events_session_idx     on public.events (session_id);
create index if not exists events_host_idx        on public.events (host);
create index if not exists events_props_gin       on public.events using gin (props jsonb_path_ops);

-- =====================================================================
-- Row Level Security: anon role gets INSERT only.
-- The service_role bypasses RLS by default and is what the dashboard
-- uses for SELECTs.
-- =====================================================================
alter table public.events enable row level security;

drop policy if exists "anon insert events" on public.events;
create policy "anon insert events"
  on public.events for insert
  to anon
  with check (true);

-- Defensive: explicitly deny SELECT/UPDATE/DELETE for anon.
drop policy if exists "no anon read"   on public.events;
drop policy if exists "no anon update" on public.events;
drop policy if exists "no anon delete" on public.events;

-- =====================================================================
-- Daily-rollup view used by the dashboard's "Overview" page.
-- Materialize on demand — for a personal-scale workload this query is
-- cheap enough to run live; promote to a materialized view if needed.
-- =====================================================================
create or replace view public.events_daily as
select
  date_trunc('day', received_at) as day,
  host,
  name,
  count(*) as cnt,
  count(distinct anon_id) as uniq_users,
  count(distinct session_id) as uniq_sessions
from public.events
group by 1, 2, 3
order by 1 desc, 4 desc;

-- =====================================================================
-- Retention policy: drop events older than 180 days.
-- Schedule via Supabase pg_cron (Database → Extensions → pg_cron).
-- Uncomment and run once you've enabled pg_cron:
-- =====================================================================
-- select cron.schedule(
--   'vibe-check-events-retention',
--   '0 4 * * *',  -- every day at 04:00 UTC
--   $$ delete from public.events where received_at < now() - interval '180 days' $$
-- );
