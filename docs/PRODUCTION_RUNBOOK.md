# StudyPilot AI Production Runbook

Concise operational procedures for StudyPilot AI production deployment and incident response.

## Deploy Steps

### Pre-Deploy Checklist
- [ ] All CI checks pass (lint, typecheck, unit tests, E2E, build, whitespace)
- [ ] Migrations applied and verified in staging
- [ ] Backup/restore plan reviewed
- [ ] Admin user verified with trusted `app_metadata.role = admin`
- [ ] Student user verified as non-admin
- [ ] Health endpoints (`/api/health/live`, `/api/health/ready`) checked in staging
- [ ] Monitoring webhook configured
- [ ] Worker trigger strategy documented
- [ ] Release tagged: `git tag -a v<version> -m "Release <version>"`

### Deployment Order
1. **Database Migrations** (if any)
   - Apply to staging first
   - Verify with validation checklist
   - Apply to production
   - Run `notify pgrst, 'reload schema'`

2. **Application Deploy**
   - Deploy to Vercel (or hosting platform)
   - Verify build succeeds
   - Run smoke tests

3. **Post-Deploy Verification**
   - [ ] `/api/health/live` returns 200
   - [ ] `/api/health/ready` returns 200 with all checks OK
   - [ ] Login works
   - [ ] File upload works
   - [ ] AI chat/summary/quiz/revision work
   - [ ] Admin routes accessible
   - [ ] Monitoring events appearing

### Migration Order (when applicable)
Run in sequence:
1. `20260819000100_initial_schema.sql`
2. `20260819000200_storage.sql`
3. `20260819000300_conversations.sql`
4. `20260819000400_multilingual.sql`
5. `20260819000500_audit_logs.sql`
6. `20260819000600_background_jobs.sql`
7. `20260819000700_monitoring_events.sql`
8. Any new migrations in timestamp order

## Health Verification

### Automated Checks
- **Liveness**: `/api/health/live` - process is running
- **Readiness**: `/api/health/ready` - dependencies (DB, Storage, AI) available
- **External uptime**: Ping both endpoints every 30-60s

### Manual Smoke Tests
Run after every deployment:
1. Sign in as student
2. Upload a PDF → verify extraction → verify summary
3. Generate quiz → attempt quiz
4. Create revision plan
5. Chat with AI assistant
6. Sign in as admin → verify all admin pages load

## Rollback Procedure

### Application Rollback
1. `vercel rollback` (or platform equivalent) to previous deployment
2. Verify health endpoints
3. Run smoke tests

### Database Rollback
**Do not run down migrations.** Instead:
1. Stop application deployments
2. Restore database from latest backup (PITR to pre-migration timestamp)
3. Or: Apply corrective forward migration
4. Verify application works with restored schema

### Full Rollback (App + DB)
1. Rollback application deployment
2. Restore database via PITR
3. Verify both layers compatible

## Incident Response

### Supabase Outage
1. Confirm via `/api/health/ready` (database/storage checks fail)
2. Check Supabase status page
3. Pause deployments and background workers
4. Do not run migrations until service healthy
5. Communicate status to users via status page

### AI Provider Outage (Gemini/NVIDIA)
1. Confirm via monitoring events (`ai.provider` with `errorCategory`)
2. Keep saved-note fallback enabled
3. Switch `AI_PROVIDER` or `SUMMARY_AI_PROVIDER` env var **only after testing in staging**
4. Monitor fallback rate

### Storage Outage
1. Confirm via `/api/health/ready` (storage check fails)
2. Upload and PDF preview may fail
3. Do not delete file metadata while storage degraded
4. Check Supabase status page

### Worker Jobs Stuck
1. Check `background_jobs` for old `processing` rows (>15 min)
2. Trigger worker manually:
   ```bash
   curl -X POST https://<domain>/api/jobs/worker \
     -H "x-studypilot-worker-secret: $STUDYPILOT_WORKER_SECRET" \
     -H "Content-Type: application/json" \
     -d '{"maxJobs": 5}'
   ```
3. Or use admin fallback (sign in as admin, call same endpoint)
4. Verify retry counts before manual requeue

### Repeated 5xx Errors
1. Inspect request IDs in monitoring events
2. Check recent deployment, env changes, provider status
3. Roll back only after confirming failing release
4. If DB-related: check Supabase logs

### Admin Access Recovery
1. Verify user has `app_metadata.role = 'admin'` in Supabase Auth
2. Run `scripts/set-admin-role.sql` if needed (service role required)
3. Check middleware RLS policies

## Failed Job Recovery

### Automatic
- Stale locks recovered after `STUDYPILOT_JOB_STALE_LOCK_MS` (default 15 min)
- Retries with exponential backoff (max 5 min delay, max 3 attempts by default)

### Manual
1. Find failed jobs: `SELECT * FROM background_jobs WHERE status = 'failed' ORDER BY created_at DESC;`
2. Reset for retry:
   ```sql
   UPDATE background_jobs
   SET status = 'retrying', locked_at = NULL, locked_by = NULL, next_run_at = now()
   WHERE id = '<job-id>';
   ```
3. Trigger worker

### Idempotency
- Jobs use `idempotency_key` to prevent duplicate processing
- Safe to requeue; duplicate enqueues return existing job

## Secret Rotation

| Secret | Rotation Frequency | Procedure |
|--------|-------------------|-----------|
| `SUPABASE_SERVICE_ROLE_KEY` | 90 days | Supabase Dashboard → Settings → API → Rotate |
| `GEMINI_API_KEY` | 90 days | Google AI Studio → Regenerate |
| `NVIDIA_API_KEY` | 90 days | NVIDIA NGC → Regenerate |
| `STUDYPILOT_WORKER_SECRET` | 90 days | Generate new: `openssl rand -hex 32` |
| `TAVILY_API_KEY` | 90 days | Tavily Dashboard → Regenerate |

**Rotation Procedure**:
1. Generate new secret
2. Add to staging environment
3. Verify staging works
4. Add to production environment
5. Remove old secret
6. Document in [SECRET_ROTATION.md](SECRET_ROTATION.md)

## Monitoring & Alerting

### Key Dashboards
- `/admin/monitoring` - Recent events, provider status
- `/admin/analytics` - Usage metrics
- `/admin/audit-logs` - Admin actions

### Critical Alerts (page on-call)
- Readiness failure 3x consecutive
- 5xx rate > 5% over 5 min
- Database/storage down
- Background job failure rate > 10% over 15 min

### Warning Alerts (notify on-call)
- AI provider error spike
- Fallback rate > 50%
- Job queue backlog > 10 min
- Stale locks accumulating

## On-Call Escalation

1. **Primary**: Platform Engineer (receives pages)
2. **Secondary**: Senior Engineer (if primary unresponsive 15 min)
3. **Management**: Engineering Lead (if customer-facing impact)

## Post-Incident

1. Create incident record in tracking system
2. Run postmortem within 48 hours for SEV-1/2
3. Update runbook with lessons learned
4. File follow-up tickets for preventive work

## Quick Reference Commands

```bash
# Trigger background worker
curl -X POST $PROD_URL/api/jobs/worker \
  -H "x-studypilot-worker-secret: $WORKER_SECRET" \
  -d '{"maxJobs": 10}'

# Check health
curl $PROD_URL/api/health/live
curl $PROD_URL/api/health/ready

# View recent monitoring events (admin)
curl $PROD_URL/api/admin/monitoring

# View background jobs (admin)
curl $PROD_URL/api/jobs/worker
```

## Environment Variables (Production)

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Server-only, admin APIs |
| `GEMINI_API_KEY` | Yes | Primary AI provider |
| `NVIDIA_API_KEY` | Yes | Fallback AI provider |
| `STUDYPILOT_WORKER_SECRET` | Yes | Worker auth |
| `STUDYPILOT_MONITORING_WEBHOOK_URL` | No | External alerting |
| `STUDYPILOT_ENVIRONMENT` | Yes | `production` |
| `STUDYPILOT_RELEASE` | Yes | Git SHA or version tag |
| `AI_PROVIDER` | No | `auto` \| `gemini` \| `nvidia` |
| `SUMMARY_AI_PROVIDER` | No | `auto` \| `gemini` \| `nvidia` |

## Related Documents

- [Backup & Restore Runbook](BACKUP_RESTORE_RUNBOOK.md)
- [Incident Response](INCIDENT_RESPONSE.md)
- [Monitoring & Alerts](MONITORING.md)
- [SLO Definitions](PRODUCTION_SLO.md)
- [Secret Rotation](SECRET_ROTATION.md)