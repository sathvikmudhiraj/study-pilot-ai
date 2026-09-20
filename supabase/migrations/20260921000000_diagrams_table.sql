-- StudyPilot AI: Diagrams table for AI-generated diagram persistence
-- Run against the linked Supabase project.

begin;

create extension if not exists "pgcrypto";

create table if not exists public.diagrams (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  diagram_type text not null,
  source_type text not null,
  mermaid text not null,
  explanation text,
  source_file_id uuid references public.files(id) on delete set null,
  source_answer_id uuid references public.assistant_questions(id) on delete set null,
  language_code text not null default 'en',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.diagrams add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.diagrams add column if not exists title text;
alter table public.diagrams add column if not exists diagram_type text;
alter table public.diagrams add column if not exists source_type text;
alter table public.diagrams add column if not exists mermaid text;
alter table public.diagrams add column if not exists explanation text;
alter table public.diagrams add column if not exists source_file_id uuid references public.files(id) on delete set null;
alter table public.diagrams add column if not exists source_answer_id uuid references public.assistant_questions(id) on delete set null;
alter table public.diagrams add column if not exists language_code text default 'en';
alter table public.diagrams add column if not exists created_at timestamptz default now();
alter table public.diagrams add column if not exists updated_at timestamptz default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'diagrams_user_id_fkey'
      and conrelid = 'public.diagrams'::regclass
  ) then
    alter table public.diagrams
      add constraint diagrams_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'diagrams_source_file_id_fkey'
      and conrelid = 'public.diagrams'::regclass
  ) then
    alter table public.diagrams
      add constraint diagrams_source_file_id_fkey
      foreign key (source_file_id) references public.files(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'diagrams_source_answer_id_fkey'
      and conrelid = 'public.diagrams'::regclass
  ) then
    alter table public.diagrams
      add constraint diagrams_source_answer_id_fkey
      foreign key (source_answer_id) references public.assistant_questions(id) on delete set null;
  end if;
end $$;

update public.diagrams
set
  title = coalesce(title, 'Untitled diagram'),
  diagram_type = coalesce(diagram_type, 'flowchart'),
  source_type = coalesce(source_type, 'topic'),
  mermaid = coalesce(mermaid, 'flowchart TD'),
  explanation = coalesce(explanation, ''),
  language_code = coalesce(language_code, 'en'),
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, now())
where
  title is null
  or diagram_type is null
  or source_type is null
  or mermaid is null
  or language_code is null
  or created_at is null
  or updated_at is null;

alter table public.diagrams alter column user_id set not null;
alter table public.diagrams alter column title set not null;
alter table public.diagrams alter column diagram_type set not null;
alter table public.diagrams alter column source_type set not null;
alter table public.diagrams alter column mermaid set not null;
alter table public.diagrams alter column language_code set not null;
alter table public.diagrams alter column created_at set not null;
alter table public.diagrams alter column updated_at set not null;

alter table public.diagrams drop constraint if exists diagrams_language_code_check;
alter table public.diagrams add constraint diagrams_language_code_check
  check (language_code in ('en', 'hi', 'te', 'ta', 'kn', 'ml', 'mr', 'bn'));

alter table public.diagrams drop constraint if exists diagrams_diagram_type_check;
alter table public.diagrams add constraint diagrams_diagram_type_check
  check (diagram_type in ('flowchart', 'mind_map', 'concept_map', 'sequence_diagram', 'timeline', 'comparison_diagram', 'study_process'));

alter table public.diagrams drop constraint if exists diagrams_source_type_check;
alter table public.diagrams add constraint diagrams_source_type_check
  check (source_type in ('answer', 'file', 'summary', 'topic', 'web_search', 'deep_research'));

create index if not exists diagrams_user_id_idx on public.diagrams(user_id);
create index if not exists diagrams_user_id_created_at_idx on public.diagrams(user_id, created_at desc);
create index if not exists diagrams_source_file_id_idx on public.diagrams(source_file_id) where source_file_id is not null;
create index if not exists diagrams_source_answer_id_idx on public.diagrams(source_answer_id) where source_answer_id is not null;

drop trigger if exists set_diagrams_updated_at on public.diagrams;
create trigger set_diagrams_updated_at
before update on public.diagrams
for each row execute function public.set_updated_at();

alter table public.diagrams enable row level security;

drop policy if exists "diagrams_select_own" on public.diagrams;
create policy "diagrams_select_own"
  on public.diagrams for select
  using (auth.uid() = user_id);

drop policy if exists "diagrams_insert_own" on public.diagrams;
create policy "diagrams_insert_own"
  on public.diagrams for insert
  with check (auth.uid() = user_id);

drop policy if exists "diagrams_update_own" on public.diagrams;
create policy "diagrams_update_own"
  on public.diagrams for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "diagrams_delete_own" on public.diagrams;
create policy "diagrams_delete_own"
  on public.diagrams for delete
  using (auth.uid() = user_id);

notify pgrst, 'reload schema';

commit;