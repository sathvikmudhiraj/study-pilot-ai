create table if not exists public.learning_states (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subject text,
  topic text not null,
  topic_key text not null,
  subtopic text,
  source_file_ids uuid[] not null default '{}',
  status text not null default 'NEW' check (status in ('NEW', 'LEARNING', 'NEEDS_REVISION', 'UNDERSTOOD', 'MASTERED')),
  confidence numeric(5,2),
  last_studied_at timestamptz,
  last_reviewed_at timestamptz,
  times_reviewed integer not null default 0,
  quiz_attempts integer not null default 0,
  correct_count integer not null default 0,
  incorrect_count integer not null default 0,
  incorrect_question_ids jsonb not null default '[]'::jsonb,
  weak_concepts jsonb not null default '[]'::jsonb,
  strong_concepts jsonb not null default '[]'::jsonb,
  revision_due_at timestamptz,
  revision_status text not null default 'not_scheduled' check (revision_status in ('not_scheduled', 'due', 'scheduled', 'completed')),
  notes_created integer not null default 0,
  summary_viewed boolean not null default false,
  last_explanation_id uuid,
  last_artifact_id uuid,
  last_quiz_id uuid references public.quizzes(id) on delete set null,
  last_revision_plan_id uuid references public.revision_plans(id) on delete set null,
  unfinished_task jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, topic_key)
);

create table if not exists public.learning_evidence (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  learning_state_id uuid not null references public.learning_states(id) on delete cascade,
  evidence_type text not null check (evidence_type in ('quiz_result', 'explicit_understanding', 'explicit_confusion', 'revision_completed', 'note_created', 'summary_viewed', 'task_progress')),
  source_type text not null,
  source_id uuid,
  reason text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.revision_plans
  add column if not exists completion_status text not null default 'pending',
  add column if not exists completed_at timestamptz;

alter table public.revision_plans drop constraint if exists revision_plans_completion_status_check;
alter table public.revision_plans add constraint revision_plans_completion_status_check
  check (completion_status in ('pending', 'in_progress', 'completed'));

create index if not exists learning_states_user_status_updated_idx
  on public.learning_states(user_id, status, updated_at desc);
create index if not exists learning_states_user_last_studied_idx
  on public.learning_states(user_id, last_studied_at desc nulls last);
create index if not exists learning_states_source_files_gin_idx
  on public.learning_states using gin(source_file_ids);
create index if not exists learning_evidence_state_created_idx
  on public.learning_evidence(learning_state_id, created_at desc);
create index if not exists learning_evidence_user_type_created_idx
  on public.learning_evidence(user_id, evidence_type, created_at desc);

drop trigger if exists set_learning_states_updated_at on public.learning_states;
create trigger set_learning_states_updated_at
before update on public.learning_states
for each row execute function public.set_updated_at();

alter table public.learning_states enable row level security;
alter table public.learning_evidence enable row level security;

drop policy if exists "learning_states_select_own" on public.learning_states;
create policy "learning_states_select_own" on public.learning_states for select using (auth.uid() = user_id);
drop policy if exists "learning_states_insert_own" on public.learning_states;
create policy "learning_states_insert_own" on public.learning_states for insert with check (auth.uid() = user_id);
drop policy if exists "learning_states_update_own" on public.learning_states;
create policy "learning_states_update_own" on public.learning_states for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "learning_states_delete_own" on public.learning_states;
create policy "learning_states_delete_own" on public.learning_states for delete using (auth.uid() = user_id);

drop policy if exists "learning_evidence_select_own" on public.learning_evidence;
create policy "learning_evidence_select_own" on public.learning_evidence for select using (auth.uid() = user_id);
drop policy if exists "learning_evidence_insert_own" on public.learning_evidence;
create policy "learning_evidence_insert_own" on public.learning_evidence for insert
  with check (
    auth.uid() = user_id and exists (
      select 1 from public.learning_states state
      where state.id = learning_state_id and state.user_id = auth.uid()
    )
  );
drop policy if exists "learning_evidence_delete_own" on public.learning_evidence;
create policy "learning_evidence_delete_own" on public.learning_evidence for delete using (auth.uid() = user_id);
