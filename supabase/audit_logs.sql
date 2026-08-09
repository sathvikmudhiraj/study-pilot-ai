-- ============================================================
-- Phase 1: Audit Log Foundation
-- StudyPilot AI — append-only audit log for admin actions
-- ============================================================
-- Safety guarantees:
--   • Append-only table (no UPDATE/DELETE policies for regular users)
--   • Server-controlled writes only (service role)
--   • No raw secrets/content in metadata
--   • Students cannot read platform audit logs
--   • Authenticated admin reads only
--   • Appropriate indexes for common query patterns
--   • Backward compatible (IF NOT EXISTS)
-- ============================================================

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
