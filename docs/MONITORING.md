# StudyPilot AI Monitoring and Alerts

StudyPilot writes structured request logs and durable events to `monitoring_events` when the service-role key and migration are configured. It also supports an optional external monitoring webhook.

## External Error Tracking

Set these server environment variables:

```text
STUDYPILOT_MONITORING_WEBHOOK_URL=
STUDYPILOT_ENVIRONMENT=production
STUDYPILOT_RELEASE=<git-sha-or-release-id>
```

The webhook payload contains sanitized operational metadata only:

- service name
- environment
- release
- request ID
- route/method/status
- sanitized error category/message
- sanitized metadata

It must not include prompts, student notes, answers, emails, API keys, tokens, signed URLs, or storage paths.

## Uptime Monitoring

Use:

- `/api/health/live` for process liveness.
- `/api/health/ready` for dependency readiness.

External uptime checks should alert on repeated readiness failures, not a single transient failure.

## Recommended Alerts

- Readiness failures for 3 consecutive checks.
- Repeated 5xx responses in a 5-minute window.
- AI provider error spike.
- AI fallback spike.
- Worker job failure spike.
- Storage/database availability failure.

## Admin Review

Use `/admin/monitoring` to inspect recent durable events and provider status after alerts fire.
