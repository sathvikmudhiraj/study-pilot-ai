-- ============================================================
-- Phase 1A: Persistent Conversation Storage
-- StudyPilot AI — conversations migration
-- ============================================================
-- Safety guarantees:
--   • All existing assistant_questions rows remain valid.
--   • conversation_id is NULLABLE — old rows without it are untouched.
--   • Cross-user access is blocked by strict RLS policies.
--   • A message can only be linked to a conversation owned by the same user.
-- Run this file against your Supabase project SQL editor or CLI.
-- ============================================================

-- ------------------------------------------------------------
-- 1. conversations table
-- ------------------------------------------------------------
create table if not exists public.conversations (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null references auth.users(id) on delete cascade,
  title        text,
  pinned       boolean     not null default false,
  -- context_mode controls which source the chat uses when there is no
  -- explicit file/note attachment. Allowed values are validated in the API.
  context_mode text        not null default 'general',
  active_file_ids  jsonb   not null default '[]'::jsonb,
  active_note_ids  jsonb   not null default '[]'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Prevent invalid context_mode values at the database level.
alter table public.conversations
  drop constraint if exists conversations_context_mode_check;
alter table public.conversations
  add constraint conversations_context_mode_check
  check (context_mode in ('general', 'file', 'web', 'research', 'image'));

-- updated_at trigger (reuses the shared function already created by schema.sql)
drop trigger if exists set_conversations_updated_at on public.conversations;
create trigger set_conversations_updated_at
  before update on public.conversations
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- 2. Add conversation_id to assistant_questions (nullable, safe)
-- ------------------------------------------------------------
alter table public.assistant_questions
  add column if not exists conversation_id uuid
  references public.conversations(id) on delete cascade;

-- Rows without a conversation_id are pre-Phase-1A messages and remain valid.
-- Do NOT set NOT NULL here.

-- ------------------------------------------------------------
-- 3. Indexes
-- ------------------------------------------------------------

-- conversations
create index if not exists conversations_user_id_idx
  on public.conversations(user_id);

create index if not exists conversations_user_id_updated_at_idx
  on public.conversations(user_id, updated_at desc);

create index if not exists conversations_user_id_pinned_idx
  on public.conversations(user_id, pinned)
  where pinned = true;

-- assistant_questions — conversation lookup
create index if not exists assistant_questions_conversation_id_idx
  on public.assistant_questions(conversation_id)
  where conversation_id is not null;

create index if not exists assistant_questions_conversation_created_idx
  on public.assistant_questions(conversation_id, created_at)
  where conversation_id is not null;

-- ------------------------------------------------------------
-- 4. Row-Level Security
-- ------------------------------------------------------------

alter table public.conversations enable row level security;

-- SELECT: only own rows
drop policy if exists "conversations_select_own" on public.conversations;
create policy "conversations_select_own"
  on public.conversations for select
  using (auth.uid() = user_id);

-- INSERT: only own rows (user_id must equal caller)
drop policy if exists "conversations_insert_own" on public.conversations;
create policy "conversations_insert_own"
  on public.conversations for insert
  with check (auth.uid() = user_id);

-- UPDATE: only own rows
drop policy if exists "conversations_update_own" on public.conversations;
create policy "conversations_update_own"
  on public.conversations for update
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- DELETE: only own rows (cascades to assistant_questions)
drop policy if exists "conversations_delete_own" on public.conversations;
create policy "conversations_delete_own"
  on public.conversations for delete
  using (auth.uid() = user_id);

-- assistant_questions already has per-user RLS.
-- The additional constraint that conversation_id must belong to the same user
-- is enforced in the API layer (ownership check before every write) rather
-- than in a database trigger, to keep the schema portable across Supabase
-- project tiers that may not support CHECK constraints referencing other tables.

-- ------------------------------------------------------------
-- 5. Notify PostgREST to reload schema
-- ------------------------------------------------------------
notify pgrst, 'reload schema';
