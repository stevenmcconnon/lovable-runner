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
