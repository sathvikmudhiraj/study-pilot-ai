-- ============================================================
-- STUDYPILOT AI - SAFE MIGRATION COMMANDS
-- Apply ONLY confirmed missing migrations after verification
-- Run each migration block separately in Supabase SQL Editor
-- ============================================================

-- ============================================================
-- MIGRATION 1: audit_logs (Phase 1 - Audit Log Foundation)
-- ============================================================
-- Safety: Append-only, server-controlled writes, no student read access
-- Idempotent: Uses IF NOT EXISTS, DROP IF EXISTS for policies

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  target_type text not null,
  target_id uuid,
  result text not null check (result in ('success', 'failure', 'error')),
  reason text,
  request_id text,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Indexes for common query patterns
create index if not exists audit_logs_actor_user_id_idx on public.audit_logs(actor_user_id);
create index if not exists audit_logs_target_type_target_id_idx on public.audit_logs(target_type, target_id);
create index if not exists audit_logs_created_at_idx on public.audit_logs(created_at desc);
create index if not exists audit_logs_action_idx on public.audit_logs(action);
create index if not exists audit_logs_request_id_idx on public.audit_logs(request_id);

-- Enable RLS
alter table public.audit_logs enable row level security;

-- Admin read policy (authenticated admins only)
drop policy if exists "audit_logs_admin_read" on public.audit_logs;
create policy "audit_logs_admin_read"
  on public.audit_logs for select
  using (
    auth.uid() is not null
    and auth.jwt()->'app_metadata'->>'role' = 'admin'
  );

-- No policies for INSERT/UPDATE/DELETE - only service role can write
-- This ensures append-only, server-controlled writes

notify pgrst, 'reload schema';


-- ============================================================
-- MIGRATION 2: background_jobs (Phase 3C - Background Processing)
-- ============================================================
-- Safety: User-scoped read, admin read, service-role write only
-- Idempotent: Uses IF NOT EXISTS, DROP IF EXISTS for policies/triggers

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


-- ============================================================
-- MIGRATION 3: monitoring_events (Phase 3A - Durable Observability)
-- ============================================================
-- Safety: Admin read only, service-role write only
-- Idempotent: Uses IF NOT EXISTS, DROP IF EXISTS for policies

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


-- ============================================================
-- MIGRATION 4: conversations + assistant_questions.conversation_id (Phase 1A)
-- ============================================================
-- Safety: Strict RLS, nullable conversation_id for backward compatibility
-- Idempotent: Uses IF NOT EXISTS, DROP IF EXISTS for policies/triggers

create table if not exists public.conversations (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null references auth.users(id) on delete cascade,
  title        text,
  pinned       boolean     not null default false,
  context_mode text        not null default 'general',
  active_file_ids  jsonb   not null default '[]'::jsonb,
  active_note_ids  jsonb   not null default '[]'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.conversations
  drop constraint if exists conversations_context_mode_check;
alter table public.conversations
  add constraint conversations_context_mode_check
  check (context_mode in ('general', 'file', 'web', 'research', 'image'));

drop trigger if exists set_conversations_updated_at on public.conversations;
create trigger set_conversations_updated_at
  before update on public.conversations
  for each row execute function public.set_updated_at();

alter table public.assistant_questions
  add column if not exists conversation_id uuid
  references public.conversations(id) on delete cascade;

create index if not exists conversations_user_id_idx
  on public.conversations(user_id);

create index if not exists conversations_user_id_updated_at_idx
  on public.conversations(user_id, updated_at desc);

create index if not exists conversations_user_id_pinned_idx
  on public.conversations(user_id, pinned)
  where pinned = true;

create index if not exists assistant_questions_conversation_id_idx
  on public.assistant_questions(conversation_id)
  where conversation_id is not null;

create index if not exists assistant_questions_conversation_created_idx
  on public.assistant_questions(conversation_id, created_at)
  where conversation_id is not null;

alter table public.conversations enable row level security;

drop policy if exists "conversations_select_own" on public.conversations;
create policy "conversations_select_own"
  on public.conversations for select
  using (auth.uid() = user_id);

drop policy if exists "conversations_insert_own" on public.conversations;
create policy "conversations_insert_own"
  on public.conversations for insert
  with check (auth.uid() = user_id);

drop policy if exists "conversations_update_own" on public.conversations;
create policy "conversations_update_own"
  on public.conversations for update
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "conversations_delete_own" on public.conversations;
create policy "conversations_delete_own"
  on public.conversations for delete
  using (auth.uid() = user_id);

notify pgrst, 'reload schema';


-- ============================================================
-- MIGRATION 5: multilingual persistence (Phase 2)
-- ============================================================
-- Safety: Default 'en', backfill existing rows, check constraints
-- Idempotent: Uses IF NOT EXISTS, updates only where needed

begin;

alter table public.conversations add column if not exists language_code text default 'en';
alter table public.assistant_questions add column if not exists language_code text default 'en';
alter table public.ai_outputs add column if not exists language_code text default 'en';
alter table public.quizzes add column if not exists language_code text default 'en';
alter table public.revision_plans add column if not exists language_code text default 'en';

update public.conversations set language_code = 'en' where language_code is null;
update public.assistant_questions set language_code = 'en' where language_code is null;
update public.ai_outputs set language_code = 'en' where language_code is null;
update public.quizzes set language_code = 'en' where language_code is null;
update public.revision_plans set language_code = 'en' where language_code is null;

update public.conversations set language_code = 'en' where language_code not in ('en', 'hi', 'te', 'ta', 'kn', 'ml', 'mr', 'bn');
update public.assistant_questions set language_code = 'en' where language_code not in ('en', 'hi', 'te', 'ta', 'kn', 'ml', 'mr', 'bn');
update public.ai_outputs set language_code = 'en' where language_code not in ('en', 'hi', 'te', 'ta', 'kn', 'ml', 'mr', 'bn');
update public.quizzes set language_code = 'en' where language_code not in ('en', 'hi', 'te', 'ta', 'kn', 'ml', 'mr', 'bn');
update public.revision_plans set language_code = 'en' where language_code not in ('en', 'hi', 'te', 'ta', 'kn', 'ml', 'mr', 'bn');

alter table public.conversations alter column language_code set default 'en', alter column language_code set not null;
alter table public.assistant_questions alter column language_code set default 'en', alter column language_code set not null;
alter table public.ai_outputs alter column language_code set default 'en', alter column language_code set not null;
alter table public.quizzes alter column language_code set default 'en', alter column language_code set not null;
alter table public.revision_plans alter column language_code set default 'en', alter column language_code set not null;

alter table public.conversations drop constraint if exists conversations_language_code_check;
alter table public.conversations add constraint conversations_language_code_check check (language_code in ('en', 'hi', 'te', 'ta', 'kn', 'ml', 'mr', 'bn'));
alter table public.assistant_questions drop constraint if exists assistant_questions_language_code_check;
alter table public.assistant_questions add constraint assistant_questions_language_code_check check (language_code in ('en', 'hi', 'te', 'ta', 'kn', 'ml', 'mr', 'bn'));
alter table public.ai_outputs drop constraint if exists ai_outputs_language_code_check;
alter table public.ai_outputs add constraint ai_outputs_language_code_check check (language_code in ('en', 'hi', 'te', 'ta', 'kn', 'ml', 'mr', 'bn'));
alter table public.quizzes drop constraint if exists quizzes_language_code_check;
alter table public.quizzes add constraint quizzes_language_code_check check (language_code in ('en', 'hi', 'te', 'ta', 'kn', 'ml', 'mr', 'bn'));
alter table public.revision_plans drop constraint if exists revision_plans_language_code_check;
alter table public.revision_plans add constraint revision_plans_language_code_check check (language_code in ('en', 'hi', 'te', 'ta', 'kn', 'ml', 'mr', 'bn'));

create index if not exists assistant_questions_language_lookup_idx
  on public.assistant_questions (user_id, conversation_id, language_code, created_at desc);
create index if not exists ai_outputs_language_lookup_idx
  on public.ai_outputs (user_id, file_id, note_id, output_type, language_code, created_at desc);
create index if not exists quizzes_language_lookup_idx
  on public.quizzes (user_id, language_code, created_at desc);
create index if not exists revision_plans_language_lookup_idx
  on public.revision_plans (user_id, language_code, created_at desc);

notify pgrst, 'reload schema';

commit;


-- ============================================================
-- MIGRATION 6: storage bucket (study-files)
-- ============================================================
-- Safety: Private bucket, user-scoped path access
-- Idempotent: Uses ON CONFLICT DO UPDATE

insert into storage.buckets (id, name, public, allowed_mime_types)
values (
  'study-files',
  'study-files',
  false,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'text/markdown',
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/zip',
    'application/x-zip-compressed'
  ]
)
on conflict (id) do update
set
  name = excluded.name,
  public = false,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "study_files_select_own" on storage.objects;
create policy "study_files_select_own"
on storage.objects
for select
using (
  bucket_id = 'study-files'
  and auth.uid() is not null
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "study_files_insert_own" on storage.objects;
create policy "study_files_insert_own"
on storage.objects
for insert
with check (
  bucket_id = 'study-files'
  and auth.uid() is not null
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "study_files_update_own" on storage.objects;
create policy "study_files_update_own"
on storage.objects
for update
using (
  bucket_id = 'study-files'
  and auth.uid() is not null
  and auth.uid()::text = (storage.foldername(name))[1]
)
with check (
  bucket_id = 'study-files'
  and auth.uid() is not null
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "study_files_delete_own" on storage.objects;
create policy "study_files_delete_own"
on storage.objects
for delete
using (
  bucket_id = 'study-files'
  and auth.uid() is not null
  and auth.uid()::text = (storage.foldername(name))[1]
);

notify pgrst, 'reload schema';


-- ============================================================
-- POST-MIGRATION VERIFICATION QUERIES
-- Run after each migration to confirm it was applied correctly
-- ============================================================

-- Verify audit_logs
SELECT 'audit_logs' AS table_name, table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'audit_logs';
SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'audit_logs' ORDER BY ordinal_position;
SELECT schemaname, tablename, policyname, cmd FROM pg_policies WHERE schemaname = 'public' AND tablename = 'audit_logs';
SELECT schemaname, tablename, indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'audit_logs';

-- Verify background_jobs
SELECT 'background_jobs' AS table_name, table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'background_jobs';
SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'background_jobs' ORDER BY ordinal_position;
SELECT schemaname, tablename, policyname, cmd FROM pg_policies WHERE schemaname = 'public' AND tablename = 'background_jobs';
SELECT schemaname, tablename, indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'background_jobs';

-- Verify monitoring_events
SELECT 'monitoring_events' AS table_name, table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'monitoring_events';
SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'monitoring_events' ORDER BY ordinal_position;
SELECT schemaname, tablename, policyname, cmd FROM pg_policies WHERE schemaname = 'public' AND tablename = 'monitoring_events';
SELECT schemaname, tablename, indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'monitoring_events';

-- Verify conversations
SELECT 'conversations' AS table_name, table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'conversations';
SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'conversations' ORDER BY ordinal_position;
SELECT schemaname, tablename, policyname, cmd FROM pg_policies WHERE schemaname = 'public' AND tablename = 'conversations';

-- Verify assistant_questions.conversation_id
SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'assistant_questions' AND column_name = 'conversation_id';

-- Verify language_code columns
SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND column_name = 'language_code'
  AND table_name IN ('conversations', 'assistant_questions', 'ai_outputs', 'quizzes', 'revision_plans')
ORDER BY table_name;

-- Verify storage bucket
SELECT id, name, public FROM storage.buckets WHERE id = 'study-files';
SELECT policyname, cmd FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE '%study_files%';