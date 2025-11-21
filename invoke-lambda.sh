#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: ./invoke-lambda.sh [options]

Invokes the Lovable Lambda via its function URL.

Options:
  --profile <name>    AWS CLI profile for discovery (default: $AWS_PROFILE or lovable)
  --region <name>     AWS region (default: $AWS_REGION or us-east-1)
  --function <name>   Lambda function name (default: $LOVABLE_LAMBDA_FUNCTION or lovable-launch)
  --url <url>         Explicit function URL (otherwise auto-discovers)
  --payload <json>    Inline JSON payload (default posts example bootstrap request)
  --payload-file <p>  Read JSON payload from file
  -h, --help          Show this help
EOF
}

PROFILE="${AWS_PROFILE:-lovable}"
REGION="${AWS_REGION:-us-east-1}"
FUNCTION_NAME="${LOVABLE_LAMBDA_FUNCTION:-lovable-launch}"
FUNCTION_URL="${LOVABLE_FUNCTION_URL:-}"
INLINE_PAYLOAD=""
PAYLOAD_FILE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile)
      PROFILE="$2"
      shift 2
      ;;
    --region)
      REGION="$2"
      shift 2
      ;;
    --function)
      FUNCTION_NAME="$2"
      shift 2
      ;;
    --url)
      FUNCTION_URL="$2"
      shift 2
      ;;
    --payload)
      INLINE_PAYLOAD="$2"
      shift 2
      ;;
    --payload-file)
      PAYLOAD_FILE="$2"
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

if [[ -n "${PAYLOAD_FILE}" ]]; then
  if [[ ! -f "${PAYLOAD_FILE}" ]]; then
    echo "Payload file not found: ${PAYLOAD_FILE}" >&2
    exit 1
  fi
  PAYLOAD="$(cat "${PAYLOAD_FILE}")"
elif [[ -n "${INLINE_PAYLOAD}" ]]; then
  PAYLOAD="${INLINE_PAYLOAD}"
else
  PAYLOAD='{"url":"https://example.com","wait":10,"attempts":40}'
fi

if [[ -z "${FUNCTION_URL}" ]]; then
  echo "Discovering function URL for ${FUNCTION_NAME}..."
  FUNCTION_URL="$(aws lambda get-function-url-config \
    --function-name "${FUNCTION_NAME}" \
    --profile "${PROFILE}" \
    --region "${REGION}" \
    --query 'FunctionUrl' \
    --output text 2>/dev/null || true)"
fi

if [[ -z "${FUNCTION_URL}" ]]; then
  echo "Unable to determine function URL. Provide it via --url or LOVABLE_FUNCTION_URL." >&2
  exit 1
fi

echo "Invoking ${FUNCTION_URL}..."
curl -sS -X POST "${FUNCTION_URL}" \
  -H "Content-Type: application/json" \
  -d "${PAYLOAD}"
echo
