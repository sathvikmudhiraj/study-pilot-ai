# StudyPilot AI Production SLO / SLI Definitions

This document defines measurable Service Level Objectives (SLOs) and Service Level Indicators (SLIs) for StudyPilot AI production deployment.

## Service Level Indicators (SLIs)

| SLI | Description | Measurement |
|-----|-------------|-------------|
| **Availability** | Successful HTTP responses (2xx, 3xx) / Total requests | `/api/health/live` + application requests |
| **Latency (p95)** | 95th percentile response time | Request duration from `monitoring_events` |
| **API Error Rate** | 5xx responses / Total requests | Status >= 500 from `monitoring_events` |
| **Admin API Availability** | Successful admin requests / Total admin requests | `/api/admin/*` routes |
| **AI Request Success** | Successful AI generations / Total AI requests | `event_type = 'ai.provider'` with `event = 'provider_finished'` |
| **File Processing Success** | Completed PDF extractions / Total extraction jobs | `background_jobs` with `job_type = 'pdf_extraction'` and `status = 'completed'` |
| **Background Job Success** | Completed jobs / Total jobs | `background_jobs` with `status = 'completed'` |
| **Readiness** | `/api/health/ready` returns 200 | Health check endpoint |

## Service Level Objectives (SLOs)

### Core Application
| Metric | Target | Measurement Window |
|--------|--------|-------------------|
| **Availability** | >= 99.9% | 30-day rolling |
| **API Error Rate (5xx)** | < 1% | 30-day rolling |
| **Latency p95** | < 2000ms | 30-day rolling |
| **Readiness** | >= 99.95% | 30-day rolling |

### Admin Operations
| Metric | Target | Measurement Window |
|--------|--------|-------------------|
| **Admin API Availability** | >= 99.9% | 30-day rolling |
| **Admin API Latency p95** | < 3000ms | 30-day rolling |

### AI Services
| Metric | Target | Measurement Window |
|--------|--------|-------------------|
| **AI Request Success Rate** | >= 99% | 30-day rolling |
| **AI Fallback Rate** | < 5% | 30-day rolling |
| **AI Latency p95** | < 30000ms | 30-day rolling |

### File Processing
| Metric | Target | Measurement Window |
|--------|--------|-------------------|
| **PDF Extraction Success** | >= 99% | 30-day rolling |
| **Summary Generation Success** | >= 99% | 30-day rolling |
| **File Processing Latency p95** | < 60000ms | 30-day rolling |

### Background Processing
| Metric | Target | Measurement Window |
|--------|--------|-------------------|
| **Background Job Success Rate** | >= 99% | 30-day rolling |
| **Job Queue Backlog (max age)** | < 10 minutes | Continuous |
| **Stale Lock Recovery Rate** | 100% | Continuous |

## Error Budget Policy

- **Error Budget** = (1 - SLO Target) × Measurement Window
- When error budget < 25%: Alert on-call, pause non-critical deployments
- When error budget < 10%: Freeze deployments, focus on reliability
- When error budget exhausted: Incident response, postmortem required

## Alerting Thresholds

| Alert | Condition | Severity |
|-------|-----------|----------|
| **Readiness Failure** | 3 consecutive `/api/health/ready` failures | Critical |
| **High 5xx Rate** | 5xx > 5% over 5 minutes | Critical |
| **Database Down** | Readiness check `database.status = "down"` | Critical |
| **Storage Down** | Readiness check `storage.status = "down"` | Critical |
| **AI Provider Failure Spike** | AI error rate > 20% over 10 minutes | Warning |
| **AI Fallback Spike** | Fallback rate > 50% over 10 minutes | Warning |
| **Background Job Failure Rate** | Job failure rate > 5% over 15 minutes | Warning |
| **Job Queue Backlog** | Oldest queued job > 10 minutes | Warning |
| **Stale Lock Accumulation** | > 5 jobs in `processing` with stale locks | Warning |

## Measurement Implementation

All SLIs are derived from:
- `monitoring_events` table (request logs, AI telemetry, health checks)
- `background_jobs` table (job queue metrics)
- `/api/health/live` and `/api/health/ready` endpoints

External monitoring should scrape:
- `/api/health/live` every 30s (liveness)
- `/api/health/ready` every 60s (readiness)

## Review Cadence

- **Weekly**: SLO dashboard review in team sync
- **Monthly**: Error budget burn rate analysis
- **Quarterly**: SLO target recalibration based on business needs