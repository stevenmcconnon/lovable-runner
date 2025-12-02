#!/usr/bin/env bash
set -euo pipefail

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required" >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required" >&2
  exit 1
fi

if ! command -v aws >/dev/null 2>&1 && [[ "${SKIP_AUTH:-0}" != "1" ]]; then
  echo "aws CLI is required (set SKIP_AUTH=1 for local unauthenticated servers)" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
if [[ -f "${ROOT_DIR}/.env" ]]; then
  # shellcheck disable=SC1090
  source "${ROOT_DIR}/.env"
fi

STACK_NAME="${STACK_NAME:-lovable-runner-api}"
AWS_PROFILE="${AWS_PROFILE:-lovable}"
API_BASE="${API_BASE:-http://localhost:3000}"
API_BASE="${API_BASE%/}"
SOURCE_URL="${1:-${SOURCE_URL:-https://www.cflonline.com/}}"
REQUEST_DESC="${2:-Automated endpoint validation}"
RUN_ID=$(date +%s)
DOCS_TOKEN="${DOCS_TOKEN:-${SITE_DOCS_TOKEN:-}}"

COGNITO_DOMAIN="${COGNITO_DOMAIN:-}"
COGNITO_M2M_CLIENT_ID="${COGNITO_M2M_CLIENT_ID:-}"
COGNITO_M2M_CLIENT_SECRET="${COGNITO_M2M_CLIENT_SECRET:-}"
USER_POOL_ID="${USER_POOL_ID:-}"
DEPLOY_BUCKET="${DEPLOY_BUCKET:-}"

log() {
  echo "[$(date -u +"%H:%M:%S")] $*"
}

cleanup() {
  if [[ -n "${slug:-}" ]]; then
    log "Test run complete for slug: $slug"
  fi
}
trap cleanup EXIT

discover_stack_settings() {
  if [[ -n "${COGNITO_M2M_CLIENT_ID}" && -n "${COGNITO_DOMAIN}" && -n "${DEPLOY_BUCKET}" ]]; then
    return
  fi
  log "Fetching stack outputs from ${STACK_NAME}"
  local stack_json
  stack_json="$(aws cloudformation describe-stacks --stack-name "${STACK_NAME}" --profile "${AWS_PROFILE}" --output json)"
  COGNITO_M2M_CLIENT_ID="${COGNITO_M2M_CLIENT_ID:-$(echo "${stack_json}" | jq -r '.Stacks[0].Outputs[] | select(.OutputKey=="UserPoolMachineClientId") | .OutputValue')}"
  USER_POOL_ID="$(echo "${stack_json}" | jq -r '.Stacks[0].Outputs[] | select(.OutputKey=="UserPoolId") | .OutputValue')"
  DEPLOY_BUCKET="${DEPLOY_BUCKET:-$(echo "${stack_json}" | jq -r '.Stacks[0].Parameters[] | select(.ParameterKey=="DeployBucket") | .ParameterValue')}"
  if [[ -z "${COGNITO_DOMAIN}" ]]; then
    COGNITO_DOMAIN="$(echo "${stack_json}" | jq -r '.Stacks[0].Parameters[] | select(.ParameterKey=="CognitoDomain") | .ParameterValue')"
  fi
  if [[ -z "${COGNITO_DOMAIN}" && -n "${USER_POOL_ID}" ]]; then
    COGNITO_DOMAIN="$(aws cognito-idp describe-user-pool --user-pool-id "${USER_POOL_ID}" --profile "${AWS_PROFILE}" --query 'UserPool.Domain' --output text 2>/dev/null || true)"
  fi
}

ensure_cognito_settings() {
  discover_stack_settings
  if [[ -z "${COGNITO_DOMAIN}" || -z "${COGNITO_M2M_CLIENT_ID}" ]]; then
    echo "Unable to determine Cognito domain or machine client id. Set COGNITO_DOMAIN/COGNITO_M2M_CLIENT_ID or run with SKIP_AUTH=1." >&2
    exit 1
  fi
  if [[ "${COGNITO_DOMAIN}" != *"amazoncognito.com"* ]]; then
    REGION_FROM_ENV="${AWS_REGION:-us-east-1}"
    COGNITO_DOMAIN="${COGNITO_DOMAIN}.auth.${REGION_FROM_ENV}.amazoncognito.com"
  fi
}

ACCESS_TOKEN=""
if [[ "${SKIP_AUTH:-0}" != "1" ]]; then
  ensure_cognito_settings
  log "Requesting machine token..."
  TOKEN_RESPONSE="$(curl -sS -X POST "https://${COGNITO_DOMAIN}/oauth2/token" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "grant_type=client_credentials&client_id=${COGNITO_M2M_CLIENT_ID}${COGNITO_M2M_CLIENT_SECRET:+&client_secret=${COGNITO_M2M_CLIENT_SECRET}}")"
  ACCESS_TOKEN="$(echo "${TOKEN_RESPONSE}" | jq -r '.access_token')"
  if [[ -z "${ACCESS_TOKEN}" || "${ACCESS_TOKEN}" == "null" ]]; then
    echo "Failed to fetch access token. Response: ${TOKEN_RESPONSE}" >&2
    exit 1
  fi
else
  log "SKIP_AUTH=1 set; assuming unauthenticated API target."
fi

auth_header=()
raw_auth_headers=()
if [[ -n "${ACCESS_TOKEN}" ]]; then
  auth_header=(-H "Authorization: Bearer ${ACCESS_TOKEN}")
  raw_auth_headers=(-H "Authorization: Bearer ${ACCESS_TOKEN}")
fi

api_request() {
  local method=$1
  local path=$2
  local payload="${3:-}"
  shift 3 || true
  local -a extra_headers=("$@")
  local url="${API_BASE}${path}"
  local cmd=(curl -sfS -X "$method")
  if [[ ${#auth_header[@]} -gt 0 ]]; then
    cmd+=("${auth_header[@]}")
  fi
  if [[ ${#extra_headers[@]} -gt 0 ]]; then
    cmd+=("${extra_headers[@]}")
  fi
  cmd+=("$url")
  if [[ -n "${payload}" ]]; then
    cmd+=(-H "Content-Type: application/json" -d "$payload")
  fi
  "${cmd[@]}"
}

wait_for_generation() {
  local request_id=$1
  local label=$2
  local sleep_seconds=5
  local tmp
  tmp=$(mktemp)
  while true; do
    local http_code
    http_code=$(curl -s -o "${tmp}" -w "%{http_code}" -X GET "${API_BASE}/admin/site-launches/${request_id}" "${raw_auth_headers[@]}")
    local status_response
    status_response="$(cat "${tmp}")"
    if [[ "${http_code}" == "200" ]]; then
      local status
      status=$(echo "${status_response}" | jq -r '.status')
      >&2 log "Status (${label}): ${status_response}"
      if [[ "${status}" == "queued" || "${status}" == "running" || "${status}" == "building" || "${status}" == "deploying" ]]; then
        sleep "${sleep_seconds}"
        continue
      fi
      rm -f "${tmp}"
      echo "${status_response}"
      return 0
    fi
    if [[ "${http_code}" == "404" && -n "${DEPLOY_BUCKET}" ]]; then
      status_response="$(aws s3 cp "s3://${DEPLOY_BUCKET}/site-builds/status/${request_id}.json" - --profile "${AWS_PROFILE}" 2>/dev/null || true)"
      if [[ -n "${status_response}" ]]; then
        local status
        status=$(echo "${status_response}" | jq -r '.status' 2>/dev/null || echo '')
        >&2 log "S3 Status (${label}): ${status_response}"
        if [[ "${status}" == "queued" || "${status}" == "running" || "${status}" == "building" || "${status}" == "deploying" || -z "${status}" ]]; then
          sleep "${sleep_seconds}"
          continue
        fi
        rm -f "${tmp}"
        echo "${status_response}"
        return 0
      fi
    fi
    >&2 log "Unexpected status response (${http_code}): ${status_response}"
    sleep "${sleep_seconds}"
  done
}

queue_and_wait() {
  local method=$1
  local path=$2
  local payload=$3
  local label=$4
  local response
  response=$(api_request "$method" "$path" "$payload")
  local request_id
  request_id=$(echo "$response" | jq -r '.requestId')
  if [[ -z "${request_id}" || "${request_id}" == "null" ]]; then
    echo "Failed to queue ${label}. Response: ${response}" >&2
    exit 1
  fi
  wait_for_generation "${request_id}" "${label}"
}

if [[ -n "${DOCS_TOKEN}" ]]; then
  log "Validating /openapi.json and /docs (token protected)"
  api_request GET "/openapi.json" "" "-H" "x-docs-token: ${DOCS_TOKEN}" >/dev/null
  api_request GET "/docs" "" "-H" "x-docs-token: ${DOCS_TOKEN}" >/dev/null
else
  log "DOCS_TOKEN not provided; skipping doc endpoint checks."
fi

log "Launching new site from ${SOURCE_URL}"
launch_payload=$(jq -n \
  --arg url "$SOURCE_URL" \
  --arg desc "$REQUEST_DESC (run $RUN_ID)" \
  '{
    url: $url,
    description: $desc,
    businessDetails: {
      businessName: "CFL Online QA",
      businessType: "Electrical services",
      phone: "(555) 111-2222",
      additionalDetails: "Regression test harness"
    }
  }')
launch_response=$(api_request POST "/launch" "$launch_payload")
echo "$launch_response" | jq .
request_id=$(echo "$launch_response" | jq -r '.requestId')
if [[ -z "${request_id}" || "${request_id}" == "null" ]]; then
  echo "Launch did not return requestId" >&2
  exit 1
fi
launch_status=$(wait_for_generation "${request_id}" "launch")
slug=$(echo "${launch_status}" | jq -r '.slug')
public_url=$(echo "${launch_status}" | jq -r '.publicUrl')
if [[ -z "${slug}" || "${slug}" == "null" ]]; then
  echo "Failed to resolve slug from launch status: ${launch_status}" >&2
  exit 1
fi
log "Launch completed: slug=${slug}, preview=${public_url}"

log "Fetching site configuration"
api_request GET "/sites/${slug}" "" | jq '.site.meta, .site.theme' >/dev/null

log "Listing assets (expected empty on fresh launch)"
api_request GET "/sites/${slug}/assets" "" | jq '.items | length' >/dev/null

log "Requesting signed upload URL"
upload_payload=$(jq -n \
  --arg filename "van-$RUN_ID.png" \
  --arg contentType "image/png" \
  '{filename: $filename, contentType: $contentType}')
api_request POST "/sites/${slug}/assets" "$upload_payload" | jq '.key, .uploadUrl' >/dev/null

log "Queuing JSON patch via PATCH /sites/{slug}"
patch_payload=$(jq -n \
  --arg rid "patch-$RUN_ID" \
  '{
    patch: {
      theme: {
        primaryColor: "#1b64f2",
        accentColor: "#f97316",
        backgroundStyle: "gradient",
        vibe: "tech"
      }
    },
    requestId: $rid
  }')
patch_status=$(queue_and_wait PATCH "/sites/${slug}" "$patch_payload" "patch")
echo "$patch_status" | jq '.publicUrl'

log "Queuing instruction edit"
instruction_payload=$(jq -n \
  --arg instr "Move testimonials above the FAQ, highlight Greater Orlando coverage in the hero headline, and add a CTA linking to /book-service." \
  --arg rid "instr-$RUN_ID" \
  '{instructions: $instr, requestId: $rid, regenerateImages: false}')
instruction_status=$(queue_and_wait POST "/sites/${slug}/instructions" "$instruction_payload" "instruction")
instruction_preview=$(echo "$instruction_status" | jq -r '.publicUrl')

log "Refreshing assets list"
api_request GET "/sites/${slug}/assets" "" | jq '.items | length' >/dev/null

log "Re-fetching site config to confirm edits"
api_request GET "/sites/${slug}" "" | jq '.site.theme, (.site.sections | length)' >/dev/null

log "All API endpoints validated successfully."
log "Final preview URL: ${instruction_preview:-$public_url}"
