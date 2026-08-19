-- ============================================================
-- Phase 3A: Durable Observability
-- StudyPilot AI - operational monitoring events
-- ============================================================
-- Stores only operational metadata. Do not store prompts, note text, answers,
-- emails, API keys, tokens, signed URLs, or private storage paths.

create table if not exists public.monitoring_events (
  id uuid primary key default gen_random_uuid(),
  request_id text,
  event_type text not null,
  route text,
  method text,
  status integer,
  duration_ms integer,
  provider text,
  model text,
  retry_count integer,
  fallback_used boolean,
  error_category text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists monitoring_events_created_at_idx
  on public.monitoring_events(created_at desc);
create index if not exists monitoring_events_request_id_idx
  on public.monitoring_events(request_id)
  where request_id is not null;
create index if not exists monitoring_events_event_type_created_at_idx
  on public.monitoring_events(event_type, created_at desc);
create index if not exists monitoring_events_route_created_at_idx
  on public.monitoring_events(route, created_at desc)
  where route is not null;
create index if not exists monitoring_events_provider_created_at_idx
  on public.monitoring_events(provider, created_at desc)
  where provider is not null;
create index if not exists monitoring_events_error_created_at_idx
  on public.monitoring_events(error_category, created_at desc)
  where error_category is not null;

alter table public.monitoring_events enable row level security;

drop policy if exists "monitoring_events_admin_read" on public.monitoring_events;
create policy "monitoring_events_admin_read"
  on public.monitoring_events for select
  using (
    auth.uid() is not null
    and auth.jwt()->'app_metadata'->>'role' = 'admin'
  );

-- No insert/update/delete policies: application server writes with service role.

notify pgrst, 'reload schema';
