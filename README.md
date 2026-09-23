# StudyPilot AI

StudyPilot AI is a Next.js App Router learning workspace with Supabase authentication, private uploads, notes, summaries, quizzes, revision plans, AI chat, and protected routes.

## Hackathon Submission Content

### Problem Statement and Solution

StudyPilot AI addresses a common student problem: learning material is scattered across PDFs, slides, screenshots, notes, and documents, while revision remains manual and unstructured. Students often spend more time organizing material than actually learning it. Repeated passive rereading reduces active recall, generic chatbots do not understand a student's own notes, and exam preparation frequently becomes last-minute and stressful.

StudyPilot AI solves this by bringing the complete study workflow into one personalized workspace. Students can upload their study material, after which the system extracts and processes the content and generates concise summaries, key points, important questions, MCQ quizzes, contextual Ask My Notes responses, and revision plans. The outputs remain connected to the student's own material, making the assistance more relevant than a generic chatbot.

The workflow is:

```text
Upload -> Extract -> Generate -> Practice -> Revise
```

The platform uses authenticated per-user storage and database access so each student's files and generated outputs remain isolated. Quiz attempts, revision plans, summaries, and conversations are persisted so learning can continue across sessions.

The objective is to reduce the gap between "I have notes" and "I am ready for the exam" by turning passive study material into an active, repeatable learning loop.

### Technology Used: IBM Bob

IBM Bob was used in StudyPilot AI as a development-time engineering assistant, mainly for debugging, code review, validation, and production-readiness review. It was not used as the student-facing runtime AI model.

[Read IBM Bob Usage](./IBM_BOB_USAGE.md)

During development, IBM Bob was used to inspect implementation issues, analyze errors and code paths, review API and authentication behavior, identify edge cases, and act as a second reviewer before fixes were accepted. It helped review areas such as admin APIs, analytics, audit-log filtering, authentication flows, persistence, storage behavior, and end-to-end application workflows.

The development workflow followed this pattern:

```text
Build / Modify Feature -> IBM Bob Review -> Identify Bug or Edge Case -> Debug / Fix -> Run Tests -> Final Review
```

IBM Bob was also used to validate whether a proposed fix addressed the root cause without introducing unrelated changes. After fixes were made, the project was verified using linting, TypeScript checks, unit tests, Playwright end-to-end tests, production builds, and Git diff checks.

This made IBM Bob useful as a debugger, code reviewer, second reviewer for fixes, issue and edge-case identifier, and production-readiness support tool. The actual student-facing AI functionality in StudyPilot AI remains handled by the application's configured AI providers and application logic.

## Environment

Create `.env.local` from `.env.example`. Keep all provider keys server-side and never commit real secrets.

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
AI_PROVIDER=auto
AI_PROVIDER_TIMEOUT_MS=30000
SUMMARY_AI_PROVIDER=auto
SUMMARY_AI_TIMEOUT_MS=120000
SUMMARY_NVIDIA_MODEL=meta/llama-3.2-11b-vision-instruct
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash
GEMINI_FALLBACK_MODEL=gemini-2.0-flash
NVIDIA_API_KEY=
NVIDIA_BASE_URL=https://integrate.api.nvidia.com/v1
NVIDIA_MODEL=meta/llama-3.2-11b-vision-instruct
TAVILY_API_KEY=
```

## Supabase Setup

Run these SQL files in the Supabase SQL Editor in order:

1. `supabase/schema.sql`
2. `supabase/storage.sql`
3. `supabase/multilingual.sql` when upgrading an existing database that has not received the multilingual migration

The storage bucket must remain private. RLS policies in the SQL files restrict user-owned records and storage objects.

## Development

```bash
npm ci
npm run dev
```

Open the local URL printed by Next.js, normally `http://localhost:3000`.

## Continuous Integration

`.github/workflows/ci.yml` runs for every push and pull request targeting `main`. The job uses Node.js 24 LTS with npm caching and runs these gates in order:

```bash
npm run lint
npx tsc --noEmit
npm test
npm run test:e2e
npm run build
git diff --check
```

Older runs for the same branch are cancelled. The workflow has read-only repository permissions and a 40-minute job timeout.

### E2E Modes

When Supabase and isolated E2E credentials are configured, CI runs the complete authenticated Playwright suite. When they are unavailable, such as on an untrusted fork, CI emits a visible warning and runs only signed-out smoke tests. A smoke-only run must not be treated as full authenticated E2E coverage.

Chromium and its Linux dependencies are installed in CI. Playwright screenshots, traces, videos, and HTML reports are uploaded as a seven-day GitHub Actions artifact only when a workflow fails.

## GitHub Actions Secrets

Configure these under **Repository settings > Secrets and variables > Actions**:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `GEMINI_API_KEY`
- `NVIDIA_API_KEY`
- `TAVILY_API_KEY`
- `STUDYPILOT_E2E_EMAIL`
- `STUDYPILOT_E2E_PASSWORD`

The E2E account must be an isolated test user, never a personal or production administrator account. Configure the equivalent runtime variables separately in Vercel; GitHub Actions secrets are not automatically shared with Vercel.

## Failed Workflow Artifacts

Open the failed run under the repository's **Actions** tab. The job log identifies the failed gate and whether E2E ran in `full` or `smoke` mode. For Playwright failures, download the `playwright-failure-<run>-<attempt>` artifact from the run summary and inspect `playwright-report` or the retained trace with:

```bash
npx playwright show-trace path/to/trace.zip
```

## Deployment

Use Vercel Git integration as the deployment owner. No `deploy.yml` is included because a second GitHub Actions deployment would duplicate Vercel's automatic Git deployment and could create competing production releases.

Recommended configuration:

1. Connect the GitHub repository to Vercel.
2. Set `main` as the production branch.
3. Keep pull-request preview deployments separate from production.
4. Add all runtime environment variables to the correct Vercel Preview and Production environments.
5. Protect `main` and require the `CI / Validate` check before merging.
6. Block direct pushes and require branches to be current before merge. This ensures production commits were validated before reaching `main`.

Do not add an Actions-based Vercel deployment unless Vercel Git integration is intentionally disabled. If that strategy changes, the deployment workflow must depend on successful CI and use separate preview and production environments.

## Rollback

For an application regression, promote the previous known-good Vercel deployment or revert the offending commit and allow CI to validate the revert before it reaches `main`. For database changes, use forward-compatible corrective migrations; do not roll back by deleting production data or editing previously applied migrations.

## Local Validation

Run the same checks before opening a pull request:

```bash
npm run lint
npx tsc --noEmit
npm test
npm run test:e2e
npm run build
git diff --check
```

Set `STUDYPILOT_E2E_EMAIL` and `STUDYPILOT_E2E_PASSWORD` locally to run authenticated E2E scenarios. Without them, credential-dependent Playwright tests are skipped and the result is smoke coverage only.
