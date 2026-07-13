create extension if not exists "pgcrypto";

create table if not exists public.files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  file_name text not null,
  file_type text,
  file_size bigint,
  storage_path text,
  extracted_text text,
  processing_status text default 'uploaded',
  chunks_count integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  mime_type text,
  status text default 'uploaded',
  original_file_name text,
  content_type text,
  processing_notes jsonb default '[]'::jsonb,
  extracted_metadata jsonb default '{}'::jsonb
);

alter table public.files add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.files add column if not exists file_name text;
alter table public.files add column if not exists file_type text;
alter table public.files add column if not exists file_size bigint;
alter table public.files add column if not exists storage_path text;
alter table public.files add column if not exists extracted_text text;
alter table public.files add column if not exists processing_status text default 'uploaded';
alter table public.files add column if not exists chunks_count integer default 0;
alter table public.files add column if not exists created_at timestamptz default now();
alter table public.files add column if not exists updated_at timestamptz default now();
alter table public.files add column if not exists mime_type text;
alter table public.files add column if not exists status text default 'uploaded';
alter table public.files add column if not exists original_file_name text;
alter table public.files add column if not exists content_type text;
alter table public.files add column if not exists processing_notes jsonb default '[]'::jsonb;
alter table public.files add column if not exists extracted_metadata jsonb default '{}'::jsonb;
alter table public.files alter column id set default gen_random_uuid();
alter table public.files alter column processing_status set default 'uploaded';
alter table public.files alter column chunks_count set default 0;
alter table public.files alter column created_at set default now();
alter table public.files alter column updated_at set default now();
alter table public.files alter column status set default 'uploaded';
alter table public.files alter column processing_notes set default '[]'::jsonb;
alter table public.files alter column extracted_metadata set default '{}'::jsonb;
update public.files
set
  file_name = coalesce(file_name, 'Untitled file'),
  file_type = coalesce(file_type, 'pdf'),
  original_file_name = coalesce(original_file_name, file_name, 'Untitled file'),
  content_type = coalesce(content_type, file_type, 'pdf'),
  file_size = coalesce(file_size, 0),
  processing_status = coalesce(processing_status, status, 'uploaded'),
  chunks_count = coalesce(chunks_count, 0),
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, now()),
  processing_notes = coalesce(processing_notes, '[]'::jsonb),
  extracted_metadata = coalesce(extracted_metadata, '{}'::jsonb),
  status = coalesce(status, processing_status, 'uploaded')
where
  file_name is null
  or file_type is null
  or original_file_name is null
  or content_type is null
  or file_size is null
  or processing_status is null
  or chunks_count is null
  or created_at is null
  or updated_at is null
  or processing_notes is null
  or extracted_metadata is null
  or status is null;
alter table public.files alter column user_id set not null;
alter table public.files alter column file_name set not null;

create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  source_type text not null default 'manual',
  topic text not null,
  raw_notes text not null,
  key_link text,
  note_date date,
  importance text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  content text,
  metadata jsonb default '{}'::jsonb,
  file_id uuid references public.files(id) on delete cascade
);

alter table public.notes add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.notes add column if not exists title text;
alter table public.notes add column if not exists source_type text default 'manual';
alter table public.notes add column if not exists topic text;
alter table public.notes add column if not exists raw_notes text;
alter table public.notes add column if not exists key_link text;
alter table public.notes add column if not exists note_date date;
alter table public.notes add column if not exists importance text;
alter table public.notes add column if not exists created_at timestamptz default now();
alter table public.notes add column if not exists updated_at timestamptz default now();
alter table public.notes add column if not exists content text;
alter table public.notes add column if not exists metadata jsonb default '{}'::jsonb;
alter table public.notes add column if not exists file_id uuid references public.files(id) on delete cascade;
alter table public.notes alter column id set default gen_random_uuid();
alter table public.notes alter column source_type set default 'manual';
alter table public.notes alter column created_at set default now();
alter table public.notes alter column updated_at set default now();
alter table public.notes alter column metadata set default '{}'::jsonb;
update public.notes
set
  title = coalesce(title, 'Untitled note'),
  source_type = coalesce(source_type, 'manual'),
  topic = coalesce(topic, ''),
  raw_notes = coalesce(raw_notes, content, ''),
  content = coalesce(content, raw_notes, ''),
  metadata = coalesce(metadata, '{}'::jsonb),
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, now())
where
  title is null
  or source_type is null
  or topic is null
  or raw_notes is null
  or content is null
  or metadata is null
  or created_at is null
  or updated_at is null;
alter table public.notes alter column user_id set not null;
alter table public.notes alter column title set not null;
alter table public.notes alter column source_type set not null;
alter table public.notes alter column topic set not null;
alter table public.notes alter column raw_notes set not null;

create table if not exists public.ai_outputs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  file_id uuid references public.files(id) on delete cascade,
  note_id uuid references public.notes(id) on delete cascade,
  short_summary text,
  key_points jsonb default '[]'::jsonb,
  action_items jsonb default '[]'::jsonb,
  important_concepts jsonb default '[]'::jsonb,
  suggested_tags jsonb default '[]'::jsonb,
  suggested_title text,
  suggested_next_step text,
  module_overview text,
  covered_topics jsonb default '[]'::jsonb,
  topic_wise_summary jsonb default '[]'::jsonb,
  exam_focus_points jsonb default '[]'::jsonb,
  memory_lines jsonb default '[]'::jsonb,
  common_mistakes jsonb default '[]'::jsonb,
  source_citations jsonb default '[]'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  output_type text,
  prompt text,
  content text,
  model text
);

alter table public.ai_outputs add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.ai_outputs add column if not exists file_id uuid references public.files(id) on delete cascade;
alter table public.ai_outputs add column if not exists note_id uuid references public.notes(id) on delete cascade;
alter table public.ai_outputs add column if not exists short_summary text;
alter table public.ai_outputs add column if not exists key_points jsonb default '[]'::jsonb;
alter table public.ai_outputs add column if not exists action_items jsonb default '[]'::jsonb;
alter table public.ai_outputs add column if not exists important_concepts jsonb default '[]'::jsonb;
alter table public.ai_outputs add column if not exists suggested_tags jsonb default '[]'::jsonb;
alter table public.ai_outputs add column if not exists suggested_title text;
alter table public.ai_outputs add column if not exists suggested_next_step text;
alter table public.ai_outputs add column if not exists module_overview text;
alter table public.ai_outputs add column if not exists covered_topics jsonb default '[]'::jsonb;
alter table public.ai_outputs add column if not exists topic_wise_summary jsonb default '[]'::jsonb;
alter table public.ai_outputs add column if not exists exam_focus_points jsonb default '[]'::jsonb;
alter table public.ai_outputs add column if not exists memory_lines jsonb default '[]'::jsonb;
alter table public.ai_outputs add column if not exists common_mistakes jsonb default '[]'::jsonb;
alter table public.ai_outputs add column if not exists source_citations jsonb default '[]'::jsonb;
alter table public.ai_outputs add column if not exists created_at timestamptz default now();
alter table public.ai_outputs add column if not exists updated_at timestamptz default now();
alter table public.ai_outputs add column if not exists output_type text;
alter table public.ai_outputs add column if not exists prompt text;
alter table public.ai_outputs add column if not exists content text;
alter table public.ai_outputs add column if not exists model text;
alter table public.ai_outputs alter column id set default gen_random_uuid();
alter table public.ai_outputs alter column key_points set default '[]'::jsonb;
alter table public.ai_outputs alter column action_items set default '[]'::jsonb;
alter table public.ai_outputs alter column important_concepts set default '[]'::jsonb;
alter table public.ai_outputs alter column suggested_tags set default '[]'::jsonb;
alter table public.ai_outputs alter column covered_topics set default '[]'::jsonb;
alter table public.ai_outputs alter column topic_wise_summary set default '[]'::jsonb;
alter table public.ai_outputs alter column exam_focus_points set default '[]'::jsonb;
alter table public.ai_outputs alter column memory_lines set default '[]'::jsonb;
alter table public.ai_outputs alter column common_mistakes set default '[]'::jsonb;
alter table public.ai_outputs alter column source_citations set default '[]'::jsonb;
alter table public.ai_outputs alter column created_at set default now();
alter table public.ai_outputs alter column updated_at set default now();
alter table public.ai_outputs alter column output_type drop not null;
alter table public.ai_outputs alter column content drop not null;
update public.ai_outputs
set
  key_points = coalesce(key_points, '[]'::jsonb),
  action_items = coalesce(action_items, '[]'::jsonb),
  important_concepts = coalesce(important_concepts, '[]'::jsonb),
  suggested_tags = coalesce(suggested_tags, '[]'::jsonb),
  covered_topics = coalesce(covered_topics, '[]'::jsonb),
  topic_wise_summary = coalesce(topic_wise_summary, '[]'::jsonb),
  exam_focus_points = coalesce(exam_focus_points, '[]'::jsonb),
  memory_lines = coalesce(memory_lines, '[]'::jsonb),
  common_mistakes = coalesce(common_mistakes, '[]'::jsonb),
  source_citations = coalesce(source_citations, '[]'::jsonb),
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, now())
where
  key_points is null
  or action_items is null
  or important_concepts is null
  or suggested_tags is null
  or covered_topics is null
  or topic_wise_summary is null
  or exam_focus_points is null
  or memory_lines is null
  or common_mistakes is null
  or source_citations is null
  or created_at is null
  or updated_at is null;
alter table public.ai_outputs alter column user_id set not null;

create table if not exists public.quizzes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  file_id uuid references public.files(id) on delete set null,
  note_id uuid references public.notes(id) on delete set null,
  quiz_title text,
  difficulty text,
  questions jsonb default '[]'::jsonb,
  answer_key jsonb default '[]'::jsonb,
  created_at timestamptz default now(),
  title text,
  updated_at timestamptz default now()
);

alter table public.quizzes add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.quizzes add column if not exists file_id uuid references public.files(id) on delete set null;
alter table public.quizzes add column if not exists note_id uuid references public.notes(id) on delete set null;
alter table public.quizzes add column if not exists quiz_title text;
alter table public.quizzes add column if not exists difficulty text;
alter table public.quizzes add column if not exists questions jsonb default '[]'::jsonb;
alter table public.quizzes add column if not exists answer_key jsonb default '[]'::jsonb;
alter table public.quizzes add column if not exists created_at timestamptz default now();
alter table public.quizzes add column if not exists title text;
alter table public.quizzes add column if not exists updated_at timestamptz default now();
alter table public.quizzes alter column id set default gen_random_uuid();
alter table public.quizzes alter column questions set default '[]'::jsonb;
alter table public.quizzes alter column answer_key set default '[]'::jsonb;
alter table public.quizzes alter column created_at set default now();
alter table public.quizzes alter column title drop not null;
update public.quizzes
set
  questions = coalesce(questions, '[]'::jsonb),
  answer_key = coalesce(answer_key, '[]'::jsonb),
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, now())
where
  questions is null
  or answer_key is null
  or created_at is null
  or updated_at is null;
alter table public.quizzes alter column user_id set not null;

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
alter table public.quiz_attempts add column if not exists created_at timestamptz default now();
alter table public.quiz_attempts add column if not exists updated_at timestamptz default now();
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
  or created_at is null
  or updated_at is null;
alter table public.quiz_attempts alter column user_id set not null;
alter table public.quiz_attempts alter column quiz_id set not null;
alter table public.quiz_attempts alter column user_answers set not null;
alter table public.quiz_attempts alter column score set not null;
alter table public.quiz_attempts alter column total_questions set not null;
alter table public.quiz_attempts alter column percentage set not null;
alter table public.quiz_attempts alter column wrong_questions set not null;
alter table public.quiz_attempts alter column weak_topics set not null;
alter table public.quiz_attempts alter column strong_topics set not null;
alter table public.quiz_attempts alter column topic_results set not null;
alter table public.quiz_attempts alter column created_at set not null;
alter table public.quiz_attempts alter column updated_at set not null;

create table if not exists public.revision_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text,
  important_topics jsonb default '[]'::jsonb,
  revise_first jsonb default '[]'::jsonb,
  pending_topics jsonb default '[]'::jsonb,
  daily_plan jsonb default '[]'::jsonb,
  created_at timestamptz default now(),
  plan jsonb default '{}'::jsonb,
  starts_on date,
  ends_on date,
  updated_at timestamptz default now()
);

alter table public.revision_plans add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.revision_plans add column if not exists title text;
alter table public.revision_plans add column if not exists important_topics jsonb default '[]'::jsonb;
alter table public.revision_plans add column if not exists revise_first jsonb default '[]'::jsonb;
alter table public.revision_plans add column if not exists pending_topics jsonb default '[]'::jsonb;
alter table public.revision_plans add column if not exists daily_plan jsonb default '[]'::jsonb;
alter table public.revision_plans add column if not exists created_at timestamptz default now();
alter table public.revision_plans add column if not exists plan jsonb default '{}'::jsonb;
alter table public.revision_plans add column if not exists starts_on date;
alter table public.revision_plans add column if not exists ends_on date;
alter table public.revision_plans add column if not exists updated_at timestamptz default now();
alter table public.revision_plans alter column id set default gen_random_uuid();
alter table public.revision_plans alter column important_topics set default '[]'::jsonb;
alter table public.revision_plans alter column revise_first set default '[]'::jsonb;
alter table public.revision_plans alter column pending_topics set default '[]'::jsonb;
alter table public.revision_plans alter column daily_plan set default '[]'::jsonb;
alter table public.revision_plans alter column created_at set default now();
alter table public.revision_plans alter column plan set default '{}'::jsonb;
alter table public.revision_plans alter column title drop not null;
update public.revision_plans
set
  important_topics = coalesce(important_topics, '[]'::jsonb),
  revise_first = coalesce(revise_first, '[]'::jsonb),
  pending_topics = coalesce(pending_topics, '[]'::jsonb),
  daily_plan = coalesce(daily_plan, '[]'::jsonb),
  plan = coalesce(plan, '{}'::jsonb),
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, now())
where
  important_topics is null
  or revise_first is null
  or pending_topics is null
  or daily_plan is null
  or plan is null
  or created_at is null
  or updated_at is null;
alter table public.revision_plans alter column user_id set not null;

create table if not exists public.assistant_questions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  question text not null,
  answer jsonb,
  related_file_ids jsonb default '[]'::jsonb,
  related_note_ids jsonb default '[]'::jsonb,
  mode text,
  created_at timestamptz default now(),
  note_id uuid references public.notes(id) on delete set null,
  status text default 'answered',
  updated_at timestamptz default now()
);

alter table public.assistant_questions add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.assistant_questions add column if not exists question text;
alter table public.assistant_questions add column if not exists answer jsonb;
alter table public.assistant_questions add column if not exists related_file_ids jsonb default '[]'::jsonb;
alter table public.assistant_questions add column if not exists related_note_ids jsonb default '[]'::jsonb;
alter table public.assistant_questions add column if not exists mode text;
alter table public.assistant_questions add column if not exists created_at timestamptz default now();
alter table public.assistant_questions add column if not exists note_id uuid references public.notes(id) on delete set null;
alter table public.assistant_questions add column if not exists status text default 'answered';
alter table public.assistant_questions add column if not exists updated_at timestamptz default now();
alter table public.assistant_questions alter column id set default gen_random_uuid();
alter table public.assistant_questions alter column related_file_ids set default '[]'::jsonb;
alter table public.assistant_questions alter column related_note_ids set default '[]'::jsonb;
alter table public.assistant_questions alter column created_at set default now();
alter table public.assistant_questions alter column status set default 'answered';
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'assistant_questions'
      and column_name = 'answer'
      and data_type <> 'jsonb'
  ) then
    alter table public.assistant_questions
    alter column answer type jsonb
    using case
      when answer is null then null
      else to_jsonb(answer)
    end;
  end if;
end;
$$;
alter table public.assistant_questions alter column answer drop not null;
update public.assistant_questions
set
  question = coalesce(question, ''),
  related_file_ids = coalesce(related_file_ids, '[]'::jsonb),
  related_note_ids = coalesce(related_note_ids, '[]'::jsonb),
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, now()),
  status = coalesce(status, 'answered')
where
  question is null
  or related_file_ids is null
  or related_note_ids is null
  or created_at is null
  or updated_at is null
  or status is null;
alter table public.assistant_questions alter column user_id set not null;
alter table public.assistant_questions alter column question set not null;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.normalize_study_note()
returns trigger
language plpgsql
as $$
begin
  new.title = coalesce(nullif(new.title, ''), 'Untitled note');
  new.source_type = coalesce(nullif(new.source_type, ''), 'manual');
  new.topic = coalesce(new.topic, '');
  new.raw_notes = coalesce(new.raw_notes, new.content, '');
  new.content = coalesce(new.content, new.raw_notes, '');
  new.metadata = coalesce(new.metadata, '{}'::jsonb);
  return new;
end;
$$;

drop trigger if exists normalize_study_note_before_write on public.notes;
create trigger normalize_study_note_before_write
before insert or update on public.notes
for each row execute function public.normalize_study_note();

drop trigger if exists set_files_updated_at on public.files;
create trigger set_files_updated_at
before update on public.files
for each row execute function public.set_updated_at();

drop trigger if exists set_notes_updated_at on public.notes;
create trigger set_notes_updated_at
before update on public.notes
for each row execute function public.set_updated_at();

drop trigger if exists set_ai_outputs_updated_at on public.ai_outputs;
create trigger set_ai_outputs_updated_at
before update on public.ai_outputs
for each row execute function public.set_updated_at();

drop trigger if exists set_quiz_attempts_updated_at on public.quiz_attempts;
create trigger set_quiz_attempts_updated_at
before update on public.quiz_attempts
for each row execute function public.set_updated_at();

alter table public.files enable row level security;
alter table public.notes enable row level security;
alter table public.ai_outputs enable row level security;
alter table public.quizzes enable row level security;
alter table public.quiz_attempts enable row level security;
alter table public.revision_plans enable row level security;
alter table public.assistant_questions enable row level security;

drop policy if exists "files_select_own" on public.files;
create policy "files_select_own" on public.files for select using (auth.uid() = user_id);
drop policy if exists "files_insert_own" on public.files;
create policy "files_insert_own" on public.files for insert with check (auth.uid() = user_id);
drop policy if exists "files_update_own" on public.files;
create policy "files_update_own" on public.files for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "files_delete_own" on public.files;
create policy "files_delete_own" on public.files for delete using (auth.uid() = user_id);

drop policy if exists "notes_select_own" on public.notes;
create policy "notes_select_own" on public.notes for select using (auth.uid() = user_id);
drop policy if exists "notes_insert_own" on public.notes;
create policy "notes_insert_own" on public.notes for insert with check (auth.uid() = user_id);
drop policy if exists "notes_update_own" on public.notes;
create policy "notes_update_own" on public.notes for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "notes_delete_own" on public.notes;
create policy "notes_delete_own" on public.notes for delete using (auth.uid() = user_id);

drop policy if exists "ai_outputs_select_own" on public.ai_outputs;
create policy "ai_outputs_select_own" on public.ai_outputs for select using (auth.uid() = user_id);
drop policy if exists "ai_outputs_insert_own" on public.ai_outputs;
create policy "ai_outputs_insert_own" on public.ai_outputs for insert with check (auth.uid() = user_id);
drop policy if exists "ai_outputs_update_own" on public.ai_outputs;
create policy "ai_outputs_update_own" on public.ai_outputs for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "ai_outputs_delete_own" on public.ai_outputs;
create policy "ai_outputs_delete_own" on public.ai_outputs for delete using (auth.uid() = user_id);

drop policy if exists "quizzes_select_own" on public.quizzes;
create policy "quizzes_select_own" on public.quizzes for select using (auth.uid() = user_id);
drop policy if exists "quizzes_insert_own" on public.quizzes;
create policy "quizzes_insert_own" on public.quizzes for insert with check (auth.uid() = user_id);
drop policy if exists "quizzes_update_own" on public.quizzes;
create policy "quizzes_update_own" on public.quizzes for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "quizzes_delete_own" on public.quizzes;
create policy "quizzes_delete_own" on public.quizzes for delete using (auth.uid() = user_id);

drop policy if exists "quiz_attempts_select_own" on public.quiz_attempts;
create policy "quiz_attempts_select_own" on public.quiz_attempts for select using (auth.uid() = user_id);
drop policy if exists "quiz_attempts_insert_own" on public.quiz_attempts;
create policy "quiz_attempts_insert_own" on public.quiz_attempts for insert with check (
  auth.uid() = user_id
  and exists (
    select 1 from public.quizzes
    where quizzes.id = quiz_attempts.quiz_id
      and quizzes.user_id = auth.uid()
  )
);
drop policy if exists "quiz_attempts_update_own" on public.quiz_attempts;
create policy "quiz_attempts_update_own" on public.quiz_attempts for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "quiz_attempts_delete_own" on public.quiz_attempts;
create policy "quiz_attempts_delete_own" on public.quiz_attempts for delete using (auth.uid() = user_id);

drop policy if exists "revision_plans_select_own" on public.revision_plans;
create policy "revision_plans_select_own" on public.revision_plans for select using (auth.uid() = user_id);
drop policy if exists "revision_plans_insert_own" on public.revision_plans;
create policy "revision_plans_insert_own" on public.revision_plans for insert with check (auth.uid() = user_id);
drop policy if exists "revision_plans_update_own" on public.revision_plans;
create policy "revision_plans_update_own" on public.revision_plans for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "revision_plans_delete_own" on public.revision_plans;
create policy "revision_plans_delete_own" on public.revision_plans for delete using (auth.uid() = user_id);

drop policy if exists "assistant_questions_select_own" on public.assistant_questions;
create policy "assistant_questions_select_own" on public.assistant_questions for select using (auth.uid() = user_id);
drop policy if exists "assistant_questions_insert_own" on public.assistant_questions;
create policy "assistant_questions_insert_own" on public.assistant_questions for insert with check (auth.uid() = user_id);
drop policy if exists "assistant_questions_update_own" on public.assistant_questions;
create policy "assistant_questions_update_own" on public.assistant_questions for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "assistant_questions_delete_own" on public.assistant_questions;
create policy "assistant_questions_delete_own" on public.assistant_questions for delete using (auth.uid() = user_id);

create index if not exists files_user_id_idx on public.files(user_id);
create index if not exists notes_user_id_idx on public.notes(user_id);
create index if not exists ai_outputs_user_id_idx on public.ai_outputs(user_id);
create index if not exists quizzes_user_id_idx on public.quizzes(user_id);
create index if not exists quiz_attempts_user_id_idx on public.quiz_attempts(user_id);
create index if not exists quiz_attempts_quiz_id_idx on public.quiz_attempts(quiz_id);
create index if not exists revision_plans_user_id_idx on public.revision_plans(user_id);
create index if not exists assistant_questions_user_id_idx on public.assistant_questions(user_id);

create index if not exists files_user_id_created_at_idx on public.files(user_id, created_at);
create index if not exists notes_user_id_created_at_idx on public.notes(user_id, created_at);
create index if not exists ai_outputs_user_id_created_at_idx on public.ai_outputs(user_id, created_at);
create index if not exists quizzes_user_id_created_at_idx on public.quizzes(user_id, created_at);
create index if not exists quiz_attempts_user_id_created_at_idx on public.quiz_attempts(user_id, created_at desc);
create index if not exists revision_plans_user_id_created_at_idx on public.revision_plans(user_id, created_at);
create index if not exists assistant_questions_user_id_created_at_idx on public.assistant_questions(user_id, created_at);

notify pgrst, 'reload schema';

-- ============================================================
-- Phase 1A additions: conversations + assistant_questions.conversation_id
-- See supabase/conversations.sql for the focused migration.
-- ============================================================

create table if not exists public.conversations (
  id               uuid        primary key default gen_random_uuid(),
  user_id          uuid        not null references auth.users(id) on delete cascade,
  title            text,
  pinned           boolean     not null default false,
  context_mode     text        not null default 'general',
  active_file_ids  jsonb       not null default '[]'::jsonb,
  active_note_ids  jsonb       not null default '[]'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table public.conversations
  drop constraint if exists conversations_context_mode_check;
alter table public.conversations
  add constraint conversations_context_mode_check
  check (context_mode in ('general', 'file', 'web', 'research', 'image'));

alter table public.assistant_questions
  add column if not exists conversation_id uuid
  references public.conversations(id) on delete cascade;

drop trigger if exists set_conversations_updated_at on public.conversations;
create trigger set_conversations_updated_at
  before update on public.conversations
  for each row execute function public.set_updated_at();

create index if not exists conversations_user_id_idx
  on public.conversations(user_id);
create index if not exists conversations_user_id_updated_at_idx
  on public.conversations(user_id, updated_at desc);
create index if not exists conversations_user_id_pinned_idx
  on public.conversations(user_id, pinned) where pinned = true;
create index if not exists assistant_questions_conversation_id_idx
  on public.assistant_questions(conversation_id) where conversation_id is not null;
create index if not exists assistant_questions_conversation_created_idx
  on public.assistant_questions(conversation_id, created_at) where conversation_id is not null;

alter table public.conversations enable row level security;

drop policy if exists "conversations_select_own" on public.conversations;
create policy "conversations_select_own"
  on public.conversations for select using (auth.uid() = user_id);
drop policy if exists "conversations_insert_own" on public.conversations;
create policy "conversations_insert_own"
  on public.conversations for insert with check (auth.uid() = user_id);
drop policy if exists "conversations_update_own" on public.conversations;
create policy "conversations_update_own"
  on public.conversations for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "conversations_delete_own" on public.conversations;
create policy "conversations_delete_own"
  on public.conversations for delete using (auth.uid() = user_id);

