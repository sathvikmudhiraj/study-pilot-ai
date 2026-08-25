-- StudyPilot AI main schema parity catch-up.
-- Forward-only, data-preserving migration for confirmed main-schema drift.
-- Safe to run repeatedly.

begin;

create extension if not exists "pgcrypto";

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Quiz attempts are required for real learning analytics. Main was verified to
-- have no PostgREST-visible quiz_attempts table, so this creates the expected
-- user-owned attempt store without touching existing quiz or user data.
create table if not exists public.quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  user_answers jsonb not null default '[]'::jsonb,
  score integer not null default 0,
  total_questions integer not null default 0,
  percentage numeric(5,2) not null default 0,
  wrong_questions jsonb not null default '[]'::jsonb,
  weak_topics jsonb not null default '[]'::jsonb,
  strong_topics jsonb not null default '[]'::jsonb,
  topic_results jsonb not null default '[]'::jsonb,
  language_code text not null default 'en',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.quiz_attempts add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.quiz_attempts add column if not exists quiz_id uuid references public.quizzes(id) on delete cascade;
alter table public.quiz_attempts add column if not exists user_answers jsonb default '[]'::jsonb;
alter table public.quiz_attempts add column if not exists score integer default 0;
alter table public.quiz_attempts add column if not exists total_questions integer default 0;
alter table public.quiz_attempts add column if not exists percentage numeric(5,2) default 0;
alter table public.quiz_attempts add column if not exists wrong_questions jsonb default '[]'::jsonb;
alter table public.quiz_attempts add column if not exists weak_topics jsonb default '[]'::jsonb;
alter table public.quiz_attempts add column if not exists strong_topics jsonb default '[]'::jsonb;
alter table public.quiz_attempts add column if not exists topic_results jsonb default '[]'::jsonb;
alter table public.quiz_attempts add column if not exists language_code text default 'en';
alter table public.quiz_attempts add column if not exists created_at timestamptz default now();
alter table public.quiz_attempts add column if not exists updated_at timestamptz default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'quiz_attempts_user_id_fkey'
      and conrelid = 'public.quiz_attempts'::regclass
  ) then
    alter table public.quiz_attempts
      add constraint quiz_attempts_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'quiz_attempts_quiz_id_fkey'
      and conrelid = 'public.quiz_attempts'::regclass
  ) then
    alter table public.quiz_attempts
      add constraint quiz_attempts_quiz_id_fkey
      foreign key (quiz_id) references public.quizzes(id) on delete cascade;
  end if;
end $$;

update public.quiz_attempts
set
  user_answers = coalesce(user_answers, '[]'::jsonb),
  score = coalesce(score, 0),
  total_questions = coalesce(total_questions, 0),
  percentage = coalesce(percentage, 0),
  wrong_questions = coalesce(wrong_questions, '[]'::jsonb),
  weak_topics = coalesce(weak_topics, '[]'::jsonb),
  strong_topics = coalesce(strong_topics, '[]'::jsonb),
  topic_results = coalesce(topic_results, '[]'::jsonb),
  language_code = coalesce(language_code, 'en'),
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, now())
where
  user_answers is null
  or score is null
  or total_questions is null
  or percentage is null
  or wrong_questions is null
  or weak_topics is null
  or strong_topics is null
  or topic_results is null
  or language_code is null
  or created_at is null
  or updated_at is null;

alter table public.quiz_attempts alter column user_id set not null;
alter table public.quiz_attempts alter column quiz_id set not null;
alter table public.quiz_attempts alter column user_answers set default '[]'::jsonb;
alter table public.quiz_attempts alter column user_answers set not null;
alter table public.quiz_attempts alter column score set default 0;
alter table public.quiz_attempts alter column score set not null;
alter table public.quiz_attempts alter column total_questions set default 0;
alter table public.quiz_attempts alter column total_questions set not null;
alter table public.quiz_attempts alter column percentage set default 0;
alter table public.quiz_attempts alter column percentage set not null;
alter table public.quiz_attempts alter column wrong_questions set default '[]'::jsonb;
alter table public.quiz_attempts alter column wrong_questions set not null;
alter table public.quiz_attempts alter column weak_topics set default '[]'::jsonb;
alter table public.quiz_attempts alter column weak_topics set not null;
alter table public.quiz_attempts alter column strong_topics set default '[]'::jsonb;
alter table public.quiz_attempts alter column strong_topics set not null;
alter table public.quiz_attempts alter column topic_results set default '[]'::jsonb;
alter table public.quiz_attempts alter column topic_results set not null;
alter table public.quiz_attempts alter column created_at set default now();
alter table public.quiz_attempts alter column created_at set not null;
alter table public.quiz_attempts alter column updated_at set default now();
alter table public.quiz_attempts alter column updated_at set not null;

-- Full-module summary fields used by file detail, quiz generation, revision,
-- exported notes, and citation-aware summary UI.
alter table public.ai_outputs add column if not exists module_overview text;
alter table public.ai_outputs add column if not exists covered_topics jsonb default '[]'::jsonb;
alter table public.ai_outputs add column if not exists topic_wise_summary jsonb default '[]'::jsonb;
alter table public.ai_outputs add column if not exists exam_focus_points jsonb default '[]'::jsonb;
alter table public.ai_outputs add column if not exists memory_lines jsonb default '[]'::jsonb;
alter table public.ai_outputs add column if not exists common_mistakes jsonb default '[]'::jsonb;
alter table public.ai_outputs add column if not exists source_citations jsonb default '[]'::jsonb;

alter table public.ai_outputs alter column covered_topics set default '[]'::jsonb;
alter table public.ai_outputs alter column topic_wise_summary set default '[]'::jsonb;
alter table public.ai_outputs alter column exam_focus_points set default '[]'::jsonb;
alter table public.ai_outputs alter column memory_lines set default '[]'::jsonb;
alter table public.ai_outputs alter column common_mistakes set default '[]'::jsonb;
alter table public.ai_outputs alter column source_citations set default '[]'::jsonb;

update public.ai_outputs
set
  covered_topics = coalesce(covered_topics, '[]'::jsonb),
  topic_wise_summary = coalesce(topic_wise_summary, '[]'::jsonb),
  exam_focus_points = coalesce(exam_focus_points, '[]'::jsonb),
  memory_lines = coalesce(memory_lines, '[]'::jsonb),
  common_mistakes = coalesce(common_mistakes, '[]'::jsonb),
  source_citations = coalesce(source_citations, '[]'::jsonb)
where
  covered_topics is null
  or topic_wise_summary is null
  or exam_focus_points is null
  or memory_lines is null
  or common_mistakes is null
  or source_citations is null;

-- Canonical content language lives on generated artifacts such as quizzes.
-- quiz_attempts.language_code is retained as a compatibility snapshot; admin
-- analytics reads quizzes.language_code through quiz_attempts.quiz_id.
alter table public.conversations add column if not exists language_code text default 'en';
alter table public.assistant_questions add column if not exists language_code text default 'en';
alter table public.ai_outputs add column if not exists language_code text default 'en';
alter table public.quizzes add column if not exists language_code text default 'en';
alter table public.revision_plans add column if not exists language_code text default 'en';
alter table public.quiz_attempts add column if not exists language_code text default 'en';

-- Populate quiz attempt language from the quiz when possible, then English.
update public.quiz_attempts qa
set language_code = q.language_code
from public.quizzes q
where qa.quiz_id = q.id
  and qa.language_code is null
  and q.language_code is not null;

update public.conversations set language_code = 'en' where language_code is null;
update public.assistant_questions set language_code = 'en' where language_code is null;
update public.ai_outputs set language_code = 'en' where language_code is null;
update public.quizzes set language_code = 'en' where language_code is null;
update public.revision_plans set language_code = 'en' where language_code is null;
update public.quiz_attempts set language_code = 'en' where language_code is null;

update public.conversations set language_code = 'en' where language_code not in ('en', 'hi', 'te', 'ta', 'kn', 'ml', 'mr', 'bn');
update public.assistant_questions set language_code = 'en' where language_code not in ('en', 'hi', 'te', 'ta', 'kn', 'ml', 'mr', 'bn');
update public.ai_outputs set language_code = 'en' where language_code not in ('en', 'hi', 'te', 'ta', 'kn', 'ml', 'mr', 'bn');
update public.quizzes set language_code = 'en' where language_code not in ('en', 'hi', 'te', 'ta', 'kn', 'ml', 'mr', 'bn');
update public.revision_plans set language_code = 'en' where language_code not in ('en', 'hi', 'te', 'ta', 'kn', 'ml', 'mr', 'bn');
update public.quiz_attempts set language_code = 'en' where language_code not in ('en', 'hi', 'te', 'ta', 'kn', 'ml', 'mr', 'bn');

alter table public.conversations alter column language_code set default 'en';
alter table public.assistant_questions alter column language_code set default 'en';
alter table public.ai_outputs alter column language_code set default 'en';
alter table public.quizzes alter column language_code set default 'en';
alter table public.revision_plans alter column language_code set default 'en';
alter table public.quiz_attempts alter column language_code set default 'en';

alter table public.conversations alter column language_code set not null;
alter table public.assistant_questions alter column language_code set not null;
alter table public.ai_outputs alter column language_code set not null;
alter table public.quizzes alter column language_code set not null;
alter table public.revision_plans alter column language_code set not null;
alter table public.quiz_attempts alter column language_code set not null;

alter table public.conversations drop constraint if exists conversations_language_code_check;
alter table public.conversations add constraint conversations_language_code_check
  check (language_code in ('en', 'hi', 'te', 'ta', 'kn', 'ml', 'mr', 'bn'));

alter table public.assistant_questions drop constraint if exists assistant_questions_language_code_check;
alter table public.assistant_questions add constraint assistant_questions_language_code_check
  check (language_code in ('en', 'hi', 'te', 'ta', 'kn', 'ml', 'mr', 'bn'));

alter table public.ai_outputs drop constraint if exists ai_outputs_language_code_check;
alter table public.ai_outputs add constraint ai_outputs_language_code_check
  check (language_code in ('en', 'hi', 'te', 'ta', 'kn', 'ml', 'mr', 'bn'));

alter table public.quizzes drop constraint if exists quizzes_language_code_check;
alter table public.quizzes add constraint quizzes_language_code_check
  check (language_code in ('en', 'hi', 'te', 'ta', 'kn', 'ml', 'mr', 'bn'));

alter table public.revision_plans drop constraint if exists revision_plans_language_code_check;
alter table public.revision_plans add constraint revision_plans_language_code_check
  check (language_code in ('en', 'hi', 'te', 'ta', 'kn', 'ml', 'mr', 'bn'));

alter table public.quiz_attempts drop constraint if exists quiz_attempts_language_code_check;
alter table public.quiz_attempts add constraint quiz_attempts_language_code_check
  check (language_code in ('en', 'hi', 'te', 'ta', 'kn', 'ml', 'mr', 'bn'));

create index if not exists conversations_user_language_updated_idx
  on public.conversations(user_id, language_code, updated_at desc);
create index if not exists assistant_questions_language_lookup_idx
  on public.assistant_questions(user_id, conversation_id, language_code, created_at desc);
create index if not exists ai_outputs_language_lookup_idx
  on public.ai_outputs(user_id, file_id, note_id, output_type, language_code, created_at desc);
create index if not exists quizzes_language_lookup_idx
  on public.quizzes(user_id, language_code, created_at desc);
create index if not exists revision_plans_language_lookup_idx
  on public.revision_plans(user_id, language_code, created_at desc);
create index if not exists quiz_attempts_user_language_created_idx
  on public.quiz_attempts(user_id, language_code, created_at desc);
create index if not exists quiz_attempts_language_code_idx
  on public.quiz_attempts(language_code);
create index if not exists quiz_attempts_user_id_idx
  on public.quiz_attempts(user_id);
create index if not exists quiz_attempts_quiz_id_idx
  on public.quiz_attempts(quiz_id);
create index if not exists quiz_attempts_user_id_created_at_idx
  on public.quiz_attempts(user_id, created_at desc);

drop trigger if exists set_quiz_attempts_updated_at on public.quiz_attempts;
create trigger set_quiz_attempts_updated_at
before update on public.quiz_attempts
for each row execute function public.set_updated_at();

alter table public.quiz_attempts enable row level security;

drop policy if exists "quiz_attempts_select_own" on public.quiz_attempts;
create policy "quiz_attempts_select_own"
  on public.quiz_attempts for select
  using (auth.uid() = user_id);

drop policy if exists "quiz_attempts_insert_own" on public.quiz_attempts;
create policy "quiz_attempts_insert_own"
  on public.quiz_attempts for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.quizzes
      where quizzes.id = quiz_attempts.quiz_id
        and quizzes.user_id = auth.uid()
    )
  );

drop policy if exists "quiz_attempts_update_own" on public.quiz_attempts;
create policy "quiz_attempts_update_own"
  on public.quiz_attempts for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "quiz_attempts_delete_own" on public.quiz_attempts;
create policy "quiz_attempts_delete_own"
  on public.quiz_attempts for delete
  using (auth.uid() = user_id);

notify pgrst, 'reload schema';

commit;
