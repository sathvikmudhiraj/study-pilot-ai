# StudyPilot AI Database Migrations

StudyPilot keeps the original SQL files in `supabase/` for reference and now has a forward-only migration baseline in `supabase/migrations/`.

## Order

Run in this order for a new staging or production project:

1. `20260819000100_initial_schema.sql`
2. `20260819000200_storage.sql`
3. `20260819000300_conversations.sql`
4. `20260819000400_multilingual.sql`
5. `20260819000500_audit_logs.sql`
6. `20260819000600_background_jobs.sql`
7. `20260819000700_monitoring_events.sql`

## Safety Rules

- Apply migrations in staging first.
- Never run destructive SQL against production without a verified backup.
- Keep RLS enabled on user-owned tables.
- Do not add service-role access to browser code.
- Treat migrations as forward-only. Recovery should use a database backup or a corrective follow-up migration.

## Verification

After applying migrations, verify:

- Authenticated student can read only their own `files`, `notes`, `ai_outputs`, quizzes, plans, and conversations.
- Admin APIs work only for users with trusted `app_metadata.role = admin`.
- `study-files` bucket is private and scoped by user-id path prefix.
- `background_jobs`, `monitoring_events`, and `audit_logs` are readable by admins only.
- `notify pgrst, 'reload schema'` has been run where included.

## Rollback / Recovery

StudyPilot does not use down migrations for production data. If a migration fails:

1. Stop deployment.
2. Capture the failed statement and Supabase project ID.
3. Restore staging from the latest backup if the failure modified data.
4. Create a new corrective migration.
5. Re-run validation before attempting production again.
