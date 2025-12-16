## Lovable Runner (local scaffold)

Local helper to:
- create a Lovable project from a source URL (requires the Lovable REST endpoints and your token)
- fetch/download the generated project source and write it to disk
- optionally zip the downloaded files
- publish the project (endpoint configurable)

This is intentionally lightweight so we can run locally now and later move it to AWS.

### Quick start
```bash
# 1) Add your credentials and endpoints
cp .env.example .env
# edit .env with your Lovable idToken (from lovable.dev) and any non-default endpoints

# 2) (optional) install deps if you add any later; none are required now
# npm install

# 3) Run (the CLI auto-loads `.env` from the project root)
node src/cli.js bootstrap --url https://example.com --zip
# or, if you already have a project id:
node src/cli.js fetch --project <project-id> --out ./output --zip
```

### Commands (CLI)
- `bootstrap` – create from a URL (default `https://example.com`), poll until the project is ready, then download the files (supports `--zip`, `--wait`, `--attempts`, `--base`, `--create-path`, `--workspace`).
- `fetch` – downloads source code for a project id, writes files to `--out` (default `./downloads/<id>`) and zips if `--zip` is passed (supports `--base`).
- `create` – posts a source URL to the configured create endpoint to kick off a new/improved project. Returns the Lovable project id (supports `--base`, `--create-path`, `--workspace`).
- `publish` – hits the configured publish endpoint for a project id (supports `--base`, `--publish-path`).
- `deploy-s3` – runs `npm install`, `npm run build`, then `aws s3 sync` from dist/build to `s3://bucket/prefix` (supports `--project-id` or `--project-dir`, `--bucket`, `--prefix`, `--profile`, `--skip-install`).
- `launch` – one-shot: create from URL, wait, download, build, and upload to S3. Requires a bucket (via `LOVABLE_DEPLOY_BUCKET` or `--bucket`), optional prefix/slug/profile/skip-install.
- `launch --placeholder-limit <n>` – cap placeholder polling attempts before continuing anyway.

### HTTP / Lambda endpoints
- `POST /launch` – the same one-shot flow as the CLI (requires authentication).
- `POST /update` – create a draft update stored under `drafts/<draftId>` in S3 and tracked in DynamoDB (admins/super-admins only).
- `POST /approve-update` – promote a draft to the live prefix (admins/super-admins only).
- `GET /updates?projectId=<id>` – list stored drafts for a given project.
- `GET /leads` – authenticated endpoint returning captured contact + booking requests for a site (includes timeline + pagination).
- `POST /leads/reply` – send an email response to a stored lead and append the outbound note to the timeline.
- `POST /leads/status` – mark a lead as open/responded/closed and schedule follow-ups.
- `GET /reviews` – public endpoint serving owner-approved reviews for on-site components.
- `POST /reviews` / `POST /reviews/status` – capture visitor reviews and approve/reject them from the admin side.
- `GET /analytics` – authenticated summary of traffic/leads/bookings plus simple health alerts.
- `POST /analytics/events` – lightweight pixel endpoint generated sites call for page views, leads, and bookings.
- `GET /appointments`, `POST /appointments/status`, `GET|POST /appointments/settings`, `GET /appointments/ics` – manage booking requests, configure availability/calendar tokens, and export ICS feeds.
- `POST /appointments/calendar/connect` – start an OAuth connect flow for Google/Outlook calendars or return an Apple ICS link to subscribe manually. OAuth callbacks live at `/oauth/calendar/{provider}/callback`.
- `POST /domains/check`, `POST /domains/register` – talk to the configured registrar to check availability or request a new domain on behalf of a customer.
- `GET|POST /notifications/preferences` – fetch or update per-recipient email preferences/unsubscribe flags so owners can opt into specific notification types.

Authentication is enforced through Amazon Cognito groups (`user`, `admin`, `super-admin`). See `infra/template.yaml` for a SAM template that provisions the Cognito pool, HTTP API Gateway, PostgreSQL database, and the Lambda function wired to all routes.

#### Custom domain & DNS
- Request an ACM certificate in `us-east-1` that covers your API host (e.g., `api.ai-sitemaker.com`). Validate it in Route 53.
- Deploy the SAM stack with `ApiCustomDomainName` and `ApiCertificateArn` parameters filled in. API Gateway will attach the custom domain to the HTTP API.
- Point `api.ai-sitemaker.com` (or whichever host you chose) to the API Gateway domain using an ALIAS/CNAME record. After propagation, all requests use `https://api.ai-sitemaker.com/...`.
- Helper scripts (no more than one parameter each):
  - `scripts/request-cert.sh <domain>` – requests/validates an ACM certificate in `us-east-1`.
  - `scripts/deploy-sam.sh` – deploys the SAM stack (configure env vars inside the script).
  - `scripts/create-api-alias.sh <hosted-zone-id>` – creates/updates the Route 53 alias once `API_DOMAIN_NAME` is exported.

#### Customer site domains
- **Namecheap integration** – provide `NAMECHEAP_API_USER`, `NAMECHEAP_API_KEY`, and (optionally) `NAMECHEAP_USERNAME` / `NAMECHEAP_API_BASE`. The SAM template wires the static NAT IP into `NAMECHEAP_CLIENT_IP` (stack output `StaticEgressIpAddress`, currently `52.2.69.55`), so whitelist that IP inside Namecheap before hitting the API.
- **Pricing & markup** – `DOMAIN_BASE_PRICE_CENTS` is the fallback registrar price (defaults to \$12), while `DOMAIN_PRICE_MARKUP_CENTS` controls the \$3 upcharge. Both can be overridden via SAM parameters/environment variables.
- **DNS payload** – every purchase/manual attach returns `dns.records` that already include:
  - `A @` records pointing at the Global Accelerator IPs (`LIVE_APEX_IPS`).
  - `CNAME www` pointing to `<slug>.<preview-domain>` until the shared CloudFront distribution is ready.
  - `_aisite` TXT verification and ACM validation CNAMEs so DNS can be copy/pasted directly into Namecheap.
- **Shared CloudFront distribution** – set `CUSTOM_DOMAIN_DISTRIBUTION_ID` (SAM parameter) to the single distribution that fronts all customer domains. Once ACM reports a certificate as `ISSUED`, the backend will call `UpdateDistribution` to add the apex + `www` aliases. Because CloudFront can only use one ACM certificate at a time, keep a dedicated SAN certificate (e.g., `arn:aws:acm:us-east-1:...:certificate/customer-domains`) up to date: append every new domain to that cert, re-run DNS validation, and then update the distribution’s `ViewerCertificate`. Until certificate automation lands, follow that runbook after every purchase.
- **Polling HTTPS state** – the API calls `refreshHttps` opportunistically (e.g., when listing domains), but you should also run the new helper on a cron: `npm run domains:refresh -- --limit 50`. The deployed stack now includes an EventBridge rule (`lovable-runner-api-domain-refresh`) that invokes the Lambda every 5 minutes with the `RUN_DOMAIN_HTTPS_REFRESH` action, so HTTPS status advances even without dashboard traffic. You can still call the script manually for ad-hoc retries.

### Database (Amazon RDS)
- The SAM stack provisions a managed PostgreSQL instance (`RunnerDatabase`) plus a Secrets Manager entry storing the username/password. Lambda receives `DATABASE_URL` automatically; local tooling can either rely on the stack metadata or pass `TEST_DATABASE_URL`.
- Required SAM parameters: `DBName`, `DBUsername`, `DBPassword`, `DBInstanceClass`, `DBAllocatedStorage`, `DbVpcId`, `DbSubnetIds`, and `DbAllowedCidr`. Defaults target the default VPC in `us-east-1` with subnets `subnet-04c228a7b5b68ff53`/`subnet-0b80e76ccd6b56ac6` and allow public access from `0.0.0.0/0` (tighten this CIDR for production).
- After deployment, fetch credentials and the host with:
  ```bash
  STACK=lovable-runner-api
  aws cloudformation describe-stacks --stack-name "$STACK" --profile lovable --query "Stacks[0].Outputs"
  aws secretsmanager get-secret-value --secret-id "${STACK}-db-credentials" --profile lovable
  ```
- Apply schema updates (see `infra/db/schema.sql`) using `psql` or let `scripts/test-api.js` run them automatically before bootstrapping a test user.

### Integration tests
- `scripts/test-api.js` runs integration checks against a deployed API. It exercises `/health`, `/me`, `/customer/*`, `/admin/*`, and the internal job endpoint (when a machine token is available).
- If `TEST_CUSTOMER_TOKEN` / `TEST_ADMIN_TOKEN` aren’t provided, set `TEST_BOOTSTRAP_USER=1`. The script now:
  1. Create a temporary Cognito user (using the default AWS profile or `AWS_PROFILE`).
  2. Inserts/updates the matching profile + roles in Postgres (fetching the RDS endpoint + secret automatically when `TEST_STACK_NAME` is left at the default `lovable-runner-api`).
  3. Runs the HTTP checks (note: the customer edit-request test triggers the runner Lambda configured in `RUNNER_FUNCTION_NAME`).
  4. Cleans up the throwaway user/profile after the suite finishes.
- Provide `TEST_MACHINE_TOKEN` or `COGNITO_DOMAIN` + `COGNITO_M2M_CLIENT_ID` + `COGNITO_M2M_CLIENT_SECRET` to include the `/internal/jobs/...` test. Set `TEST_API_BASE` to point at a specific stage if you don’t want to use the production domain.

#### Admin UI at `/admin`
- Let Lovable host your customer-facing site and add an `/admin` route (or create a separate project). The admin app should authenticate via the Cognito Hosted UI belonging to the user pool created by the SAM stack.
- After login, send the Cognito ID token in the `Authorization: Bearer <token>` header to `https://api.ai-sitemaker.com`. Users in the `admin` or `super-admin` groups can call `/update` and `/approve-update`; regular `user` group members can be limited to read-only endpoints (e.g., `GET /updates`).
- Because the backend holds the Lovable credentials, no token ever needs to be exposed to the frontend.
- **REST API** – run `npm run serve`, then POST `/launch` with JSON `{ "url": "...", "bucket": "...", "prefix": "...", "slug": "...", "wait": 10, "attempts": 60 }`. Uses the same defaults/env as `launch`.

Examples:
```bash
# One-shot create + download (default source URL is https://example.com)
node src/cli.js bootstrap --url https://example.com --zip
# Increase polling window if generation is slow:
node src/cli.js bootstrap --url https://example.com --zip --wait 10 --attempts 30
# Explicitly override base/path/workspace (matches what you saw in Network tab):
node src/cli.js bootstrap --url https://example.com --zip \
  --base https://api.lovable.dev \
  --create-path /workspaces/{workspaceId}/projects \
  --workspace <your-workspace-id>

# Build and deploy the generated project to S3
# (requires aws cli configured; defaults to downloads/<project-id>)
node src/cli.js deploy-s3 --project-id <project-id> --bucket <bucket-name> --prefix lovable/<project-id>

# One-shot create + build + deploy (uses LOVABLE_DEPLOY_BUCKET)
node src/cli.js launch --url https://example.com --bucket <bucket-name>

# REST API (one-shot via HTTP)
npm run serve
curl -X POST http://localhost:3000/launch \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com","bucket":"<bucket>","prefix":"lovable"}'

# Lambda handler (as an alternative deployment target)
# - Uses lambda.js handler, which calls runLaunch under the hood.
# - Configure environment: LOVABLE_ID_TOKEN, LOVABLE_API_BASE, LOVABLE_WORKSPACE_ID,
#   LOVABLE_CREATE_PATH, LOVABLE_DEPLOY_BUCKET, LOVABLE_DEPLOY_PREFIX, and AWS role with S3 write.
# - Payload example:
#   { "url": "https://example.com", "bucket": "<bucket>", "prefix": "lovable", "wait": 20, "attempts": 60 }

# Create a project only
node src/cli.js create --url https://example.com

# Fetch and zip a project
node src/cli.js fetch --project 1234-abcd --out ./output --zip

# Publish a project
node src/cli.js publish --project 1234-abcd
```

### Environment
- `LOVABLE_API_BASE` – e.g. `https://api.lovable.dev`
- `LOVABLE_ID_TOKEN` – bearer token (grab from lovable.dev session for now)
- `LOVABLE_WORKSPACE_ID` – workspace id to fill `{workspaceId}` in the create path
- `LOVABLE_CREATE_PATH` – path for create (default `/workspaces/{workspaceId}/projects` – adjust to the real create endpoint)
- `LOVABLE_PUBLISH_PATH` – path for publish; supports placeholders like `/projects/{id}/publish`
- `LOVABLE_DEPLOY_BUCKET` – default bucket for `launch`/`deploy-s3`
- `LOVABLE_DEPLOY_PREFIX` – optional base prefix appended before slug (e.g., `lovable`)
- `LOVABLE_PLACEHOLDER_LIMIT` – max placeholder polling attempts before continuing anyway (defaults to 30; set to `0` to disable the limit)
- `GOOGLE_CALENDAR_CLIENT_ID` / `GOOGLE_CALENDAR_CLIENT_SECRET` / `GOOGLE_CALENDAR_REDIRECT_URI` – OAuth credentials for Google Calendar syncing (`redirect_uri` defaults to `https://api.ai-sitemaker.com/oauth/calendar/google/callback`).
- `OUTLOOK_CALENDAR_CLIENT_ID` / `OUTLOOK_CALENDAR_CLIENT_SECRET` / `OUTLOOK_CALENDAR_REDIRECT_URI` – OAuth credentials for Microsoft/Outlook calendar syncing (`redirect_uri` defaults to `https://api.ai-sitemaker.com/oauth/calendar/outlook/callback`).
- Apple Calendar uses the generated ICS feed (`/appointments/ics?slug=...&token=...`), no OAuth required.

You can also pass `--token` on the CLI to override `LOVABLE_ID_TOKEN`.

### How it works
- Uses native `fetch` (Node 20) with bearer auth.
- Downloads the source via `/projects/{id}/source-code` (same payload the Tampermonkey script consumes).
- Writes files to disk, respecting nested paths and binary vs text content.
- Uses the system `zip` command to package the download when `--zip` is set.

### Notes / TODO
- The exact create/publish endpoints may differ; set `LOVABLE_CREATE_PATH`/`LOVABLE_PUBLISH_PATH` accordingly.
- No external dependencies yet; add `npm install` as needed (e.g., Playwright later for headless flows).
- Publishing may require additional headers/body—wire those up once confirmed.
- `/update` and `/approve-update` rely on DynamoDB + Cognito. Deploy via the SAM template under `infra/template.yaml` or integrate the resources into your existing IaC.
