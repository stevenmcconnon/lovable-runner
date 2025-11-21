#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: ./tail-logs.sh [options]

Streams CloudWatch logs for the lovable Lambda.

Options:
  --profile <name>   AWS CLI profile (default: $AWS_PROFILE or lovable)
  --region <name>    AWS region (default: $AWS_REGION or us-east-1)
  --function <name>  Lambda function name (default: $LOVABLE_LAMBDA_FUNCTION or lovable-launch)
  --since <window>   Lookback window passed to aws logs tail (default: 5m)
  -h, --help         Show this help
EOF
}

PROFILE="${AWS_PROFILE:-lovable}"
REGION="${AWS_REGION:-us-east-1}"
FUNCTION_NAME="${LOVABLE_LAMBDA_FUNCTION:-lovable-launch}"
SINCE="5m"

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
    --since)
      SINCE="$2"
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

LOG_GROUP="/aws/lambda/${FUNCTION_NAME}"

echo "Tailing ${LOG_GROUP} (profile: ${PROFILE}, region: ${REGION}, since: ${SINCE})..."
aws logs tail "${LOG_GROUP}" \
  --since "${SINCE}" \
  --follow \
  --profile "${PROFILE}" \
  --region "${REGION}"
