# StudyPilot AI Secret Rotation

Never commit real secrets. Update hosting/provider secrets only.

## Secrets

- `GEMINI_API_KEY`
- `NVIDIA_API_KEY`
- `TAVILY_API_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `STUDYPILOT_WORKER_SECRET`
- Supabase anon URL/key pair

## Process

1. Create the replacement key in the provider dashboard.
2. Update staging environment variables.
3. Run health checks and AI smoke tests.
4. Update production environment variables.
5. Restart/redeploy the app if the host requires it.
6. Revoke the old key after validation.
7. Record the rotation date and operator.

## Special Care

- `SUPABASE_SERVICE_ROLE_KEY` must remain server-only.
- Never add `NEXT_PUBLIC_` to AI, Tavily, worker, or service-role secrets.
- Rotate `STUDYPILOT_WORKER_SECRET` together with scheduler configuration.
