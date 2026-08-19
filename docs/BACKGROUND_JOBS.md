# StudyPilot AI Background Jobs

StudyPilot uses `background_jobs` for durable PDF extraction and summary generation.

## Statuses

- `queued`
- `processing`
- `retrying`
- `completed`
- `failed`
- `cancelled`

`failed` is the current dead-letter state. It is sufficient for beta because the row preserves `last_error_category`, `last_error_message`, attempts, and progress.

## Worker Trigger Options

- Vercel Cron calling `POST /api/jobs/worker`
- External scheduler calling `POST /api/jobs/worker`
- Secure manual trigger by an admin

Do not configure cron until production secrets are ready.

## Security

- Prefer `STUDYPILOT_WORKER_SECRET` for scheduler calls.
- Admin fallback is allowed for manual operation.
- Never log the worker secret.

## Recovery

Stale `processing` jobs are recovered by the worker after `STUDYPILOT_JOB_STALE_LOCK_MS` or the default 15 minutes. Retry delay is bounded and max attempts are capped.
