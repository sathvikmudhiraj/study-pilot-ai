# StudyPilot AI Release Checklist

Do not deploy unless every item is complete.

## Required

- `npm run lint`
- `npx tsc --noEmit`
- `npm test`
- Authenticated `npm run test:e2e`
- `npm run build`
- `git diff --check`
- `npm audit --json` reviewed
- Migrations applied and verified in staging
- Backup/restore plan reviewed
- Admin user verified with trusted `app_metadata.role = admin`
- Student user verified as non-admin
- Health live/ready endpoints checked
- Monitoring webhook or external error tracking configured
- Worker trigger strategy documented

## Rollback Preparation

- Identify last known good commit.
- Confirm database migration compatibility.
- Confirm backup timestamp.
- Confirm who can perform rollback and restore.
