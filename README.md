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
- `bootstrap` – create from a URL (default `https://example.com`), poll until the project is ready, then download the files (supports `--zip`, `--wait`, `--attempts`).
- `fetch` – downloads source code for a project id, writes files to `--out` (default `./downloads/<id>`) and zips if `--zip` is passed.
- `create` – posts a source URL to the configured create endpoint to kick off a new/improved project. Returns the Lovable project id.
- `publish` – hits the configured publish endpoint for a project id.

Examples:
```bash
# One-shot create + download (default source URL is https://example.com)
node src/cli.js bootstrap --url https://example.com --zip

# Create a project only
node src/cli.js create --url https://example.com

# Fetch and zip a project
node src/cli.js fetch --project 1234-abcd --out ./output --zip

# Publish a project
node src/cli.js publish --project 1234-abcd
```

### Environment
- `LOVABLE_API_BASE` – e.g. `https://lovable-api.com`
- `LOVABLE_ID_TOKEN` – bearer token (grab from lovable.dev session for now)
- `LOVABLE_CREATE_PATH` – path for create (default `/projects` – adjust to the real create endpoint)
- `LOVABLE_PUBLISH_PATH` – path for publish; supports placeholders like `/projects/{id}/publish`

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
