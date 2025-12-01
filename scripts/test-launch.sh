#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

if [[ -f "${ROOT_DIR}/.env" ]]; then
  # shellcheck disable=SC1090
  source "${ROOT_DIR}/.env"
fi

STACK_NAME="${STACK_NAME:-lovable-runner-api}"
AWS_PROFILE="${AWS_PROFILE:-lovable}"
COGNITO_DOMAIN="${COGNITO_DOMAIN:-}"
COGNITO_M2M_CLIENT_ID="${COGNITO_M2M_CLIENT_ID:-}"
COGNITO_M2M_CLIENT_SECRET="${COGNITO_M2M_CLIENT_SECRET:-}"
USER_POOL_ID="${USER_POOL_ID:-}"
API_BASE="${API_BASE:-${RUNNER_API_BASE:-https://api.ai-sitemaker.com}}"
API_BASE="${API_BASE%/}"

if [[ -z "${COGNITO_DOMAIN}" || -z "${COGNITO_M2M_CLIENT_ID}" ]]; then
  echo "Attempting to fetch Cognito settings from CloudFormation stack ${STACK_NAME}..."
  CF_STACK="$(aws cloudformation describe-stacks --stack-name "${STACK_NAME}" --profile "${AWS_PROFILE}" --output json 2>/dev/null || true)"
  if [[ -n "${CF_STACK}" ]]; then
    CF_OUTPUTS="$(echo "${CF_STACK}" | jq -r '.Stacks[0].Outputs')"
    if [[ -n "${CF_OUTPUTS}" && "${CF_OUTPUTS}" != "null" ]]; then
      COGNITO_M2M_CLIENT_ID="${COGNITO_M2M_CLIENT_ID:-$(echo "${CF_OUTPUTS}" | jq -r '.[] | select(.OutputKey=="UserPoolMachineClientId") | .OutputValue')}"
      USER_POOL_ID="$(echo "${CF_OUTPUTS}" | jq -r '.[] | select(.OutputKey=="UserPoolId") | .OutputValue')}"
    fi
    CF_PARAMS="$(echo "${CF_STACK}" | jq -r '.Stacks[0].Parameters')"
    if [[ -z "${COGNITO_DOMAIN}" && -n "${CF_PARAMS}" && "${CF_PARAMS}" != "null" ]]; then
      COGNITO_DOMAIN="$(echo "${CF_PARAMS}" | jq -r '.[] | select(.ParameterKey=="CognitoDomain") | .ParameterValue')"
    fi
    if [[ -n "${CF_PARAMS}" && "${CF_PARAMS}" != "null" ]]; then
      DEPLOY_BUCKET="${DEPLOY_BUCKET:-$(echo "${CF_PARAMS}" | jq -r '.[] | select(.ParameterKey=="DeployBucket") | .ParameterValue')}"
    fi
  fi
  if [[ -z "${COGNITO_DOMAIN}" && -n "${USER_POOL_ID}" ]]; then
    COGNITO_DOMAIN="$(aws cognito-idp describe-user-pool --user-pool-id "${USER_POOL_ID}" --profile "${AWS_PROFILE}" --query 'UserPool.Domain' --output text 2>/dev/null || true)"
  fi
fi

if [[ -z "${COGNITO_DOMAIN}" || -z "${COGNITO_M2M_CLIENT_ID}" ]]; then
  echo "COGNITO_DOMAIN and COGNITO_M2M_CLIENT_ID must be set (in .env or retrievable via AWS CLI)." >&2
  exit 1
fi

if [[ "${COGNITO_DOMAIN}" != *"amazoncognito.com"* ]]; then
  REGION_FROM_ENV="${AWS_REGION:-us-east-1}"
  COGNITO_DOMAIN="${COGNITO_DOMAIN}.auth.${REGION_FROM_ENV}.amazoncognito.com"
fi

TEST_MODE=0

usage() {
  echo "Usage: $0 [--simple] <url> [description]" >&2
}

POSITIONAL=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --simple)
      TEST_MODE=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      POSITIONAL+=("$1")
      shift
      ;;
  esac
done
set -- "${POSITIONAL[@]}"

if [[ $# -lt 1 ]]; then
  usage
  exit 1
fi

SOURCE_URL="$1"
DESCRIPTION="${2:-Generated via CLI}"

echo "Requesting machine token..."
TOKEN_RESPONSE="$(curl -sS -X POST "https://${COGNITO_DOMAIN}/oauth2/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials&client_id=${COGNITO_M2M_CLIENT_ID}${COGNITO_M2M_CLIENT_SECRET:+&client_secret=${COGNITO_M2M_CLIENT_SECRET}}")"
ACCESS_TOKEN="$(echo "${TOKEN_RESPONSE}" | jq -r '.access_token')"
if [[ -z "${ACCESS_TOKEN}" || "${ACCESS_TOKEN}" == "null" ]]; then
  echo "Failed to fetch access token. Response: ${TOKEN_RESPONSE}" >&2
  exit 1
fi

if [[ "${TEST_MODE}" -eq 1 ]]; then
  echo "Queuing site generation (simple test mode)..."
else
  echo "Queuing site generation..."
fi
LAUNCH_RESPONSE="$(curl -sS -X POST "${API_BASE}/launch" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "$(jq -n \
        --arg url "${SOURCE_URL}" \
        --arg desc "${DESCRIPTION}" \
        --argjson simple "${TEST_MODE}" \
        '{url:$url, description:$desc} + (if $simple == 1 then {testMode:true} else {} end)')" )"
echo "Launch response: ${LAUNCH_RESPONSE}"
REQUEST_ID="$(echo "${LAUNCH_RESPONSE}" | jq -r '.requestId')"
if [[ -z "${REQUEST_ID}" || "${REQUEST_ID}" == "null" ]]; then
  echo "Failed to queue site. Response: ${LAUNCH_RESPONSE}" >&2
  exit 1
fi

STATUS_ENDPOINT="${API_BASE}/admin/site-launches/${REQUEST_ID}"
TMP_FILE="$(mktemp)"
trap 'rm -f "${TMP_FILE}"' EXIT
echo "Polling status for request ${REQUEST_ID}..."

while true; do
  HTTP_CODE="$(curl -s -o "${TMP_FILE}" -w "%{http_code}" -X GET "${STATUS_ENDPOINT}" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}")"
  STATUS_RESPONSE="$(cat "${TMP_FILE}")"
  if [[ "${HTTP_CODE}" == "200" ]]; then
    STATUS="$(echo "${STATUS_RESPONSE}" | jq -r '.status')"
    echo "Status: ${STATUS_RESPONSE}"
    if [[ "${STATUS}" != "queued" && "${STATUS}" != "running" ]]; then
      break
    fi
  elif [[ "${HTTP_CODE}" == "404" ]]; then
    echo "Status not found in API; checking S3..."
    if [[ -n "${DEPLOY_BUCKET:-}" ]]; then
      STATUS_RESPONSE="$(aws s3 cp "s3://${DEPLOY_BUCKET}/site-builds/status/${REQUEST_ID}.json" - --profile "${AWS_PROFILE}" 2>/dev/null || true)"
      if [[ -n "${STATUS_RESPONSE}" ]]; then
        STATUS="$(echo "${STATUS_RESPONSE}" | jq -r '.status' 2>/dev/null || echo '')"
        echo "S3 Status: ${STATUS_RESPONSE}"
        if [[ "${STATUS}" != "queued" && "${STATUS}" != "running" && -n "${STATUS}" ]]; then
          break
        fi
      else
        echo "S3 status not yet available."
      fi
    else
      echo "Deploy bucket unknown; cannot check S3 status."
    fi
  else
    echo "Unexpected API response (${HTTP_CODE}): ${STATUS_RESPONSE}"
    break
  fi
  sleep 5
done

STATUS="$(echo "${STATUS_RESPONSE}" | jq -r '.status' 2>/dev/null || echo '')"
if [[ "${STATUS}" == "completed" ]]; then
  PUBLIC_URL="$(echo "${STATUS_RESPONSE}" | jq -r '.publicUrl' 2>/dev/null || echo '')"
  echo "Site ready at: ${PUBLIC_URL}"
elif [[ "${STATUS}" == "failed" ]]; then
  echo "Site generation failed: ${STATUS_RESPONSE}" >&2
  exit 1
else
  echo "Final status unknown. Response: ${STATUS_RESPONSE}" >&2
  exit 1
fi
