# StudyPilot AI Monitoring and Alerts

StudyPilot writes structured request logs and durable events to `monitoring_events` when the service-role key and migration are configured. It also supports an optional external monitoring webhook.

## External Error Tracking

Set these server environment variables:

```text
STUDYPILOT_MONITORING_WEBHOOK_URL=
STUDYPILOT_ENVIRONMENT=production
STUDYPILOT_RELEASE=<git-sha-or-release-id>
STUDYPILOT_ALERT_COOLDOWN_MS=900000
STUDYPILOT_CRITICAL_ERROR_WINDOW_MS=300000
STUDYPILOT_CRITICAL_ERROR_THRESHOLD=3
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

## Direct Alerts

When configured, StudyPilot sends direct webhook alerts for production-relevant failures while still recording durable `monitoring_events`.

Direct alert categories:

- `readiness_failed`
- `database_unhealthy`
- `storage_unhealthy`
- `ai_provider_unhealthy`
- `ai_configuration_invalid`
- `critical_errors_repeated`

Webhook delivery failures are recorded as operational events when possible and must never crash application requests or health checks.

## Repeated Error Thresholds

Repeated critical application failures are detected from recent `monitoring_events`. By default, StudyPilot alerts after 3 matching `request.failed` events within 5 minutes.

To avoid noise, alerts with the same fingerprint are suppressed for 15 minutes by default. The fingerprint is based on the route, method, error category, and alert type. A later incident after the cooldown can alert again.

## Uptime Monitoring

Use:

- `/api/health/live` for process liveness.
- `/api/health/ready` for dependency readiness.

StudyPilot can send direct readiness/dependency alerts from these checks. External uptime checks should still monitor hosted availability and alert on repeated failures from outside the app process.

## Recommended Alerts

- Readiness failures for 3 consecutive checks.
- Repeated 5xx responses in a 5-minute window.
- AI provider error spike.
- AI fallback spike.
- Worker job failure spike.
- Storage/database availability failure.

## Admin Review

Use `/admin/monitoring` to inspect recent durable events and provider status after alerts fire.
