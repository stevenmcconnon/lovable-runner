# Operations Checklist (low-cost guardrails)

- **Migrations first:** Add schema changes as SQL files in `infra/db/migrations` only; treat `infra/db/schema.sql` as reference output, not the source of truth. Run `npm run db:migrate` (or `./scripts/run-migrations-ssm.sh`) for stage/prod.
- **Pre-deploy tests:** Run `./deploy.sh --run-api-tests` to include HTTP smoke tests when credentials are available; keep the default unit tests on.
- **Analytics isolation:** Set `AnalyticsDatabaseUrl` (and leave `RequireAnalyticsIsolation=true`) so analytics writes stay off the primary DB.
- **Performance hygiene:** Before onboarding larger tenants, review query plans and add indexes for high-volume tables (leads, appointments, history/analytics) on `(slug/account_id, created_at/status)`.
- **Alarms runbook:** If queue-age/backlog or DLQ alarms fire, drain/replay after inspecting failures; for API 5xx/Lambda errors, check recent deploys/logs/X-Ray traces; for RDS CPU/connections, scale up or reduce connection churn via proxy/config.
