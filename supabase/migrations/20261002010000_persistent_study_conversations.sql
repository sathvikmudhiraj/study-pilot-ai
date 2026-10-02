-- Persistent study workspace foundation. All changes are additive and retain
-- existing conversations and assistant_questions rows.

alter table public.conversations
  add column if not exists draft_text text not null default '',
  add column if not exists draft_version bigint not null default 0,
  add column if not exists study_state jsonb not null default '{}'::jsonb;

create index if not exists conversations_user_unpinned_updated_id_idx
  on public.conversations(user_id, updated_at desc, id desc)
  where pinned = false;

create index if not exists conversations_user_pinned_updated_id_idx
  on public.conversations(user_id, updated_at desc, id desc)
  where pinned = true;

create index if not exists assistant_questions_conversation_created_id_idx
  on public.assistant_questions(conversation_id, created_at desc, id desc)
  where conversation_id is not null;

-- Search titles and persisted message/artifact payloads without exposing rows
-- owned by another user. JSON answer text includes versioned artifact metadata.
create or replace function public.search_user_conversations(
  search_query text,
  result_limit integer default 30
)
returns table (
  conversation_id uuid,
  title text,
  updated_at timestamptz,
  match_kind text,
  snippet text,
  rank integer
)
language sql
stable
security invoker
set search_path = public
as $$
  with owned as (
    select c.id, c.title, c.updated_at
    from public.conversations c
    where c.user_id = auth.uid()
  ), message_matches as (
    select distinct on (m.conversation_id)
      m.conversation_id,
      case
        when m.question ilike '%' || trim(search_query) || '%' then m.question
        else left(regexp_replace(m.answer::text, '\s+', ' ', 'g'), 240)
      end as snippet,
      case when m.question ilike '%' || trim(search_query) || '%' then 2 else 1 end as message_rank
    from public.assistant_questions m
    join owned o on o.id = m.conversation_id
    where m.user_id = auth.uid()
      and (
        m.question ilike '%' || trim(search_query) || '%'
        or m.answer::text ilike '%' || trim(search_query) || '%'
      )
    order by m.conversation_id, message_rank desc, m.created_at desc, m.id desc
  )
  select
    o.id,
    o.title,
    o.updated_at,
    case when o.title ilike '%' || trim(search_query) || '%' then 'title' else 'message' end,
    case
      when o.title ilike '%' || trim(search_query) || '%' then coalesce(o.title, 'Untitled chat')
      else mm.snippet
    end,
    (case when o.title ilike '%' || trim(search_query) || '%' then 4 else 0 end)
      + coalesce(mm.message_rank, 0)
  from owned o
  left join message_matches mm on mm.conversation_id = o.id
  where length(trim(search_query)) >= 2
    and (o.title ilike '%' || trim(search_query) || '%' or mm.conversation_id is not null)
  order by 6 desc, o.updated_at desc, o.id desc
  limit least(greatest(result_limit, 1), 50);
$$;

revoke all on function public.search_user_conversations(text, integer) from public;
grant execute on function public.search_user_conversations(text, integer) to authenticated;
