-- StudyPilot multilingual support. Safe to run repeatedly.
-- Existing rows remain English through the default and backfill below.

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

alter table public.conversations alter column language_code set default 'en';
alter table public.conversations alter column language_code set not null;
alter table public.assistant_questions alter column language_code set default 'en';
alter table public.assistant_questions alter column language_code set not null;
alter table public.ai_outputs alter column language_code set default 'en';
alter table public.ai_outputs alter column language_code set not null;
alter table public.quizzes alter column language_code set default 'en';
alter table public.quizzes alter column language_code set not null;
alter table public.revision_plans alter column language_code set default 'en';
alter table public.revision_plans alter column language_code set not null;

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
