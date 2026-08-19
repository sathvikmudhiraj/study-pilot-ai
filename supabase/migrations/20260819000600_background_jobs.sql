-- ============================================================
-- Phase 3C: Background Processing
-- StudyPilot AI - durable job queue foundation
-- ============================================================
-- Stores operational job state only. Payloads must contain identifiers and safe
-- options, never raw prompts, extracted notes, API keys, signed URLs, or tokens.

create table if not exists public.background_jobs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null check (job_type in ('pdf_extraction', 'summary_generation')),
  status text not null default 'queued' check (status in ('queued', 'processing', 'retrying', 'completed', 'failed', 'cancelled')),
  user_id uuid references auth.users(id) on delete cascade,
  file_id uuid references public.files(id) on delete cascade,
  note_id uuid references public.notes(id) on delete cascade,
  idempotency_key text unique,
  payload jsonb not null default '{}'::jsonb,
  progress jsonb not null default '{}'::jsonb,
  attempt_count integer not null default 0,
  max_attempts integer not null default 3,
  locked_at timestamptz,
  locked_by text,
  next_run_at timestamptz not null default now(),
  last_error_category text,
  last_error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_background_jobs_updated_at on public.background_jobs;
create trigger set_background_jobs_updated_at
before update on public.background_jobs
for each row execute function public.set_updated_at();

create index if not exists background_jobs_status_next_run_idx
  on public.background_jobs(status, next_run_at, created_at);
create index if not exists background_jobs_user_created_idx
  on public.background_jobs(user_id, created_at desc)
  where user_id is not null;
create index if not exists background_jobs_file_idx
  on public.background_jobs(file_id)
  where file_id is not null;
create index if not exists background_jobs_type_created_idx
  on public.background_jobs(job_type, created_at desc);

alter table public.background_jobs enable row level security;

drop policy if exists "background_jobs_admin_read" on public.background_jobs;
create policy "background_jobs_admin_read"
  on public.background_jobs for select
  using (
    auth.uid() is not null
    and auth.jwt()->'app_metadata'->>'role' = 'admin'
  );

drop policy if exists "background_jobs_user_read_own" on public.background_jobs;
create policy "background_jobs_user_read_own"
  on public.background_jobs for select
  using (auth.uid() = user_id);

-- No insert/update/delete policies: job creation and workers use service role.

notify pgrst, 'reload schema';
