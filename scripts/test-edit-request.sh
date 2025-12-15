#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/test-edit-request.sh --site-url <preview-url> --description "<change request>" --username <email> --password <password> [options]

Options:
  --site-url         Preview URL (or site slug URL) associated with the edit request (required)
  --description      Human-friendly description of the edit request (required)
  --username         Cognito username/email used for customer auth (required)
  --password         Cognito password for the above username (required)
  --api-base         API base URL (default: https://api.ai-sitemaker.com)
  --profile          AWS CLI profile for admin auth (default: $AWS_PROFILE or lovable)
  --pool-id          Override Cognito user pool id (defaults to COGNITO_USER_POOL_ID)
  --client-id        Override Cognito app client id (defaults to COGNITO_APP_CLIENT_ID)
  -h, --help         Show this help

Requirements:
  - aws CLI configured for the chosen profile (needs cognito-idp:AdminInitiateAuth permission)
  - curl installed locally
  - .env with COGNITO_USER_POOL_ID / COGNITO_APP_CLIENT_ID if not passed explicitly
EOF
}

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env"

if [[ -f "${ENV_FILE}" ]]; then
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
fi

SITE_URL=""
DESCRIPTION=""
USERNAME=""
PASSWORD=""
API_BASE="${API_BASE:-https://api.ai-sitemaker.com}"
AWS_PROFILE="${AWS_PROFILE:-lovable}"
USER_POOL_ID="${COGNITO_USER_POOL_ID:-}"
APP_CLIENT_ID="${COGNITO_APP_CLIENT_ID:-}"
AWS_REGION="${AWS_REGION:-us-east-1}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --site-url)
      SITE_URL="$2"
      shift 2
      ;;
    --description)
      DESCRIPTION="$2"
      shift 2
      ;;
    --username)
      USERNAME="$2"
      shift 2
      ;;
    --password)
      PASSWORD="$2"
      shift 2
      ;;
    --api-base)
      API_BASE="$2"
      shift 2
      ;;
    --profile)
      AWS_PROFILE="$2"
      shift 2
      ;;
    --pool-id)
      USER_POOL_ID="$2"
      shift 2
      ;;
    --client-id)
      APP_CLIENT_ID="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "${SITE_URL}" || -z "${DESCRIPTION}" || -z "${USERNAME}" || -z "${PASSWORD}" ]]; then
  echo "Missing required argument(s)." >&2
  usage
  exit 1
fi

if [[ -z "${USER_POOL_ID}" || -z "${APP_CLIENT_ID}" ]]; then
  echo "COGNITO_USER_POOL_ID and COGNITO_APP_CLIENT_ID must be set (via .env or flags)." >&2
  exit 1
fi

API_BASE="${API_BASE%/}"

echo "Requesting Cognito access token via AWS profile '${AWS_PROFILE}'..."
RAW_TOKEN="$(aws cognito-idp initiate-auth \
  --region "${AWS_REGION}" \
  --profile "${AWS_PROFILE}" \
  --client-id "${APP_CLIENT_ID}" \
  --auth-flow USER_PASSWORD_AUTH \
  --auth-parameters USERNAME="${USERNAME}",PASSWORD="${PASSWORD}" \
  --query 'AuthenticationResult.AccessToken' \
  --output text 2>/dev/null || true)"

if [[ -z "${RAW_TOKEN}" || "${RAW_TOKEN}" == "None" ]]; then
  echo "Failed to obtain Cognito token. Check credentials and AWS permissions." >&2
  exit 1
fi

ACCESS_TOKEN="$(echo -n "${RAW_TOKEN}" | tr -d '\r\n')"
echo "Token acquired. Submitting edit request..."

PAYLOAD=$(jq -n \
  --arg description "${DESCRIPTION}" \
  --arg siteId "${SITE_URL}" \
  '{description: $description, siteId: $siteId}')

RESPONSE="$(curl -sS -w '\nHTTP_STATUS:%{http_code}' \
  -X POST "${API_BASE}/customer/edit-requests" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "${PAYLOAD}")"

HTTP_STATUS="$(echo "${RESPONSE}" | sed -n 's/HTTP_STATUS://p')"
BODY="$(echo "${RESPONSE}" | sed '/HTTP_STATUS:/d')"

if [[ "${HTTP_STATUS}" != "200" && "${HTTP_STATUS}" != "201" ]]; then
  echo "Edit request failed (${HTTP_STATUS}):"
  echo "${BODY}"
  exit 1
fi

echo "Edit request created successfully:"
echo "${BODY}"
