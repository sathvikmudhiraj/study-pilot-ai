# StudyPilot AI Incident Response

## Triage

1. Check `/api/health/live`.
2. Check `/api/health/ready`.
3. Review Admin Monitoring for 5xx, provider failures, worker failures, and storage/database errors.
4. Correlate by `x-request-id`.

## Common Incidents

Gemini/NVIDIA outage:

- Confirm provider errors in monitoring events.
- Keep saved-note fallback enabled.
- Switch `AI_PROVIDER` or `SUMMARY_AI_PROVIDER` only after testing in staging.

Supabase unavailable:

- Confirm readiness failure.
- Pause deploys and background workers.
- Avoid running migrations until service is healthy.

Storage outage:

- Upload and PDF preview may fail.
- Do not delete file metadata while storage is degraded.

Worker jobs stuck:

- Check `background_jobs` for old `processing` rows.
- Trigger worker only with admin access or `STUDYPILOT_WORKER_SECRET`.
- Verify retry counts before requeueing manually.

Repeated 5xx:

- Inspect request IDs.
- Check recent deployment, env changes, and provider status.
- Roll back only after confirming the failing release.
