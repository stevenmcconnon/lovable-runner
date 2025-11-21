#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: ./deploy.sh [options]

Packages lovable-runner for Lambda and uploads it with aws cli.

Options:
  --profile <name>   AWS CLI profile to use (default: $AWS_PROFILE or lovable)
  --region <name>    AWS region (default: $AWS_REGION or us-east-1)
  --function <name>  Lambda function name (default: $LOVABLE_LAMBDA_FUNCTION or lovable-launch)
  --zip <path>       Output zip path (default: lambda.zip)
  --skip-install     Skip "npm install" (useful if deps already installed)
  -h, --help         Show this help
EOF
}

PROFILE="${AWS_PROFILE:-lovable}"
REGION="${AWS_REGION:-us-east-1}"
FUNCTION_NAME="${LOVABLE_LAMBDA_FUNCTION:-lovable-launch}"
ZIP_PATH="${LAMBDA_ZIP_PATH:-lambda.zip}"
RUN_INSTALL=1

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
    --zip)
      ZIP_PATH="$2"
      shift 2
      ;;
    --skip-install)
      RUN_INSTALL=0
      shift
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

run_npm_install() {
  if command -v corepack >/dev/null 2>&1; then
    corepack npm install
  else
    npx --yes npm@10 install
  fi
}

if [[ $RUN_INSTALL -eq 1 ]]; then
  echo "Installing npm dependencies..."
  run_npm_install
else
  echo "Skipping npm install as requested."
fi

echo "Building archive ${ZIP_PATH} ..."
rm -f "${ZIP_PATH}"
zip -rq "${ZIP_PATH}" lambda.js src package.json package-lock.json node_modules

echo "Updating Lambda function ${FUNCTION_NAME} in ${REGION} (profile: ${PROFILE})..."
aws lambda update-function-code \
  --function-name "${FUNCTION_NAME}" \
  --zip-file "fileb://${ZIP_PATH}" \
  --profile "${PROFILE}" \
  --region "${REGION}"

echo "Deploy complete."
