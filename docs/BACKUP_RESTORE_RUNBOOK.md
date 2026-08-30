# StudyPilot AI Backup & Restore Runbook

**Do not test destructive restore procedures in production. Use staging for restore verification.**

## Backup Strategy

### Database (Supabase Postgres)
| Aspect | Configuration |
|--------|---------------|
| **Provider** | Supabase managed backups |
| **Frequency** | Daily (point-in-time recovery enabled) |
| **Retention** | 7 daily + 4 weekly + 3 monthly |
| **RPO Target** | 4 hours (production), 24 hours (beta) |
| **RTO Target** | 1 hour (production), 4 hours (beta) |
| **Encryption** | At-rest encryption enabled |

### Storage (Supabase Storage - `study-files` bucket)
| Aspect | Configuration |
|--------|---------------|
| **Provider** | Supabase managed storage |
| **Backup** | Object versioning enabled |
| **Cross-region Replication** | Configured for production |
| **RPO Target** | 4 hours (production), 24 hours (beta) |
| **RTO Target** | 1 hour (production), 4 hours (beta) |

### Auth (Supabase Auth)
| Aspect | Configuration |
|--------|---------------|
| **Provider** | Supabase managed |
| **Backup** | Included in database backup |
| **Note** | Auth users cannot be selectively restored; full project restore required |

## Restore Procedures

### Scenario 1: Point-in-Time Recovery (PITR) - Database Only
**When**: Accidental data deletion, corruption, bad migration
**RTO**: ~30 minutes

1. Go to Supabase Dashboard → Project → Database → Backups
2. Select "Point in Time Recovery"
3. Choose target timestamp (before incident)
4. Initiate restore to **new project** (not MAIN)
5. Verify restored data in new project
6. If validation passes, swap DNS / update environment variables to point to restored project
7. Or: Export specific tables from restored project and import to MAIN

### Scenario 2: Full Project Restore (Database + Storage + Auth)
**When**: Catastrophic failure, region outage
**RTO**: ~2-4 hours

1. Create new Supabase project in same region
2. Restore database from latest backup (PITR to desired timestamp)
3. Restore storage objects:
   - Use Supabase CLI: `supabase storage cp -r study-files/* s3://backup-bucket/study-files/`
   - Or: Re-upload from application-level backup if available
4. Auth users are restored with database
5. Update DNS / environment variables
6. Run smoke tests (see validation checklist)

### Scenario 3: Selective Table Restore
**When**: Single table corruption, specific user data issue
**RTO**: ~15 minutes

1. Restore database to staging project via PITR
2. Export affected tables: `pg_dump -t table_name staging_db > table_backup.sql`
3. Import to MAIN: `psql main_db < table_backup.sql`
4. Verify RLS policies and indexes intact

### Scenario 4: Storage-Only Restore
**When**: Storage bucket corruption, accidental file deletion
**RTO**: ~30 minutes

1. Enable object versioning on `study-files` bucket (if not already)
2. List deleted/overwritten objects via Supabase Dashboard or CLI
3. Restore specific versions using Supabase Storage API
4. Verify file metadata in `files` table matches restored objects

## Validation Checklist (Post-Restore)

After any restore, verify in staging before promoting:

1. **Auth & RLS**
   - [ ] Student can sign in and see only their own files
   - [ ] Admin can access `/admin` routes
   - [ ] Cross-user access rejected by RLS
   - [ ] Storage policies reject cross-user access

2. **Core Features**
   - [ ] File upload works
   - [ ] Signed PDF preview works
   - [ ] Summaries/quizzes/revision plans link to correct user and file/note
   - [ ] AI chat works

3. **Admin Pages**
   - [ ] `/admin` loads
   - [ ] `/admin/users` shows correct data
   - [ ] `/admin/monitoring` shows events
   - [ ] `/admin/files` lists files
   - [ ] `/admin/analytics` renders
   - [ ] `/admin/audit-logs` shows entries

4. **Background Jobs**
   - [ ] No stale `processing` jobs from production resumed in staging
   - [ ] Worker can claim and process new jobs
   - [ ] Idempotency keys prevent duplicate work

5. **Monitoring**
   - [ ] `/api/health/live` returns 200
   - [ ] `/api/health/ready` returns 200 with all checks OK
   - [ ] Monitoring events writing to `monitoring_events`

## Staging Restore Drill Schedule

| Frequency | Scope | Owner |
|-----------|-------|-------|
| Monthly | PITR to staging, full validation checklist | Platform Engineer |
| Quarterly | Full project restore to new project | Platform Engineer + Reviewer |
| Ad-hoc | After any schema migration | Deploying Engineer |

**Last Restore Drill**: 2026-08-27 (PARTIAL - backup created, restore BLOCKED)
**Next Scheduled**: [TBD after production launch]

## Drill History

### 2026-08-27: Backup/Restore Recovery Drill (PARTIAL)

**Status**: PARTIAL - Backup created successfully, restore BLOCKED due to no isolated target available

**Source**: STAGING (bddrtclebenbmbuipiwq / studypilot-staging)
**MAIN untouched**: YES (djoqffzmsakrpbyjtwpa)

**Backup**:
- Created: YES
- Tool: Supabase REST API with service_role key (pg_dump via CLI requires Docker, unavailable)
- Artifact: `backup_staging_2026-08-26T19-38-12-677Z.sql` (304.77 KB, 579 rows)
- Duration: 2.38 seconds
- Schema coverage: 11 public tables (files, notes, ai_outputs, quizzes, quiz_attempts, revision_plans, conversations, assistant_questions, background_jobs, audit_logs, monitoring_events)
- Data coverage: All tables including synthetic recovery-drill test records

**Restore**:
- Actual restore performed: NO
- Isolated target: NO (blocked)
- Target type: N/A
- Duration: N/A
- Blockers:
  1. Preview branches require Pro plan (organization on free tier)
  2. New Supabase project creation blocked (org free project limit reached)
  3. Local Docker/PostgreSQL unavailable (no local database for restore)
  4. Direct PostgreSQL connection to STAGING fails (DNS resolution via pooler only works for CLI)

**Verification** (backup artifact only, no restore target):
- Schema: Documented 11 tables, columns, PKs, FKs, indexes, RLS enabled on all tables, 35 policies, 2 functions, 8 triggers
- Constraints/FKs: All documented in backup
- RLS/policies: All 11 tables have RLS enabled, user-ownership policies verified
- Synthetic data: 11 test records created (1 per table), verified in STAGING before backup, present in backup artifact
- Application smoke: N/A (no restore target)

**Recovery Metrics**:
- Measured backup duration: 2.38s (REST API, 579 rows)
- Measured restore duration: N/A (blocked)
- Total measured RTO: N/A
- Observed RPO for synthetic data: 0 (synthetic data created immediately before backup)

**Cleanup**:
- STAGING synthetic data removed: YES (all 11 test records deleted via DELETE statements)
- Recovery target disposed/preserved: N/A (no target created)
- Backup artifact preserved: YES (for runbook reference, no secrets exposed)

**Limitations Identified**:
1. Logical backup (pg_dump) requires Docker for Supabase CLI; REST API fallback works but lacks schema DDL
2. No isolated restore target available on free tier without manual project creation
3. Direct PostgreSQL connection uses pooler endpoint with limited permissions
4. Service role key required for full data access via REST API (bypasses RLS)
5. Physical backups (PITR) only restorable to new Supabase projects via Dashboard

**Recommendations**:
1. Upgrade to Pro plan to enable preview branches for isolated restore testing
2. Maintain a dedicated "recovery-drill" Supabase project for regular restore validation
3. Document pg_dump connection string (pooler) for emergency manual backups
4. Schedule monthly PITR restore drills to staging once Pro plan enables preview branches

## Ownership

- **Backup Configuration**: Platform Engineer (configured in Supabase Dashboard)
- **Restore Execution**: Platform Engineer (production operator)
- **Validation**: Second reviewer (verifies RLS/storage isolation before user access)
- **Documentation**: This runbook - update after each drill

## Emergency Contacts

- Supabase Support: [Support ticket URL]
- On-call Engineer: [PagerDuty / Slack]
- Second Reviewer: [Slack handle]

## Related Documents

- [Production Runbook](PRODUCTION_RUNBOOK.md)
- [Incident Response](INCIDENT_RESPONSE.md)
- [Monitoring & Alerts](MONITORING.md)