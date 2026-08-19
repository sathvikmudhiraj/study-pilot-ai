# StudyPilot AI Backup and Restore Plan

Do not test destructive restore procedures in production. Use staging for restore verification.

## Data Covered

Database:

- Auth-linked application rows
- `files`, `notes`, `ai_outputs`, `quizzes`, `quiz_attempts`
- `revision_plans`, `assistant_questions`, conversations
- `audit_logs`, `monitoring_events`, `background_jobs`

Storage:

- Private Supabase Storage bucket: `study-files`

## Recommended Targets

- RPO: 24 hours for beta, 4 hours for production.
- RTO: 4 hours for beta, 1 hour for production once operations mature.
- Retention: at least 7 daily backups and 4 weekly backups.

## Restore Verification Checklist

1. Restore database into staging.
2. Restore or copy `study-files` objects into staging storage.
3. Verify a student can sign in and see only their own files.
4. Verify signed PDF preview works.
5. Verify summaries/quizzes/revision plans still link to the correct user and file/note rows.
6. Verify admin pages load without exposing note contents unnecessarily.
7. Verify RLS and storage policies reject cross-user access.
8. Verify background jobs do not resume unsafe stale production work in staging.

## Ownership

The production operator performs restore. A second reviewer verifies RLS/storage isolation before user access is reopened.
