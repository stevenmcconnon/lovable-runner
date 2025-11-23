#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: ./deploy.sh [options]

Builds the AI SiteMaker API (TypeScript -> dist), runs `sam build`, and deploys via `sam deploy`.

Options:
  --profile <name>   AWS CLI profile (default: $AWS_PROFILE or lovable)
  --region <name>    AWS region (default: $AWS_REGION or us-east-1)
  --stack <name>     CloudFormation stack name (default: $STACK_NAME or lovable-runner-api)
  --template <path>  SAM template path (default: infra/template.yaml)
  --config-env <env> samconfig environment (default: default)
  --skip-install     Skip npm install
  --skip-build       Skip `npm run build`
  -h, --help         Show this help and exit
EOF
}

PROFILE="${AWS_PROFILE:-lovable}"
REGION="${AWS_REGION:-us-east-1}"
STACK_NAME="${STACK_NAME:-lovable-runner-api}"
SAM_TEMPLATE="${SAM_TEMPLATE:-infra/template.yaml}"
SAM_CONFIG_ENV="${SAM_CONFIG_ENV:-default}"
RUN_INSTALL=1
RUN_TS_BUILD=1

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
    --stack)
      STACK_NAME="$2"
      shift 2
      ;;
    --template)
      SAM_TEMPLATE="$2"
      shift 2
      ;;
    --config-env)
      SAM_CONFIG_ENV="$2"
      shift 2
      ;;
    --skip-install)
      RUN_INSTALL=0
      shift
      ;;
    --skip-build)
      RUN_TS_BUILD=0
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

if ! command -v sam >/dev/null 2>&1; then
  echo "sam CLI is required. Install via https://docs.aws.amazon.com/serverless-application-model/index.html" >&2
  exit 1
fi

if [[ $RUN_INSTALL -eq 1 ]]; then
  echo "Installing npm dependencies..."
  run_npm_install
else
  echo "Skipping npm install as requested."
fi

if [[ $RUN_TS_BUILD -eq 1 ]]; then
  echo "Building TypeScript sources..."
  npm run build
else
  echo "Skipping TypeScript build as requested."
fi

echo "Running sam build ($(basename "${SAM_TEMPLATE}"))..."
TMP_NPM_CACHE="$(mktemp -d)"
cleanup() {
  rm -rf "${TMP_NPM_CACHE}"
}
trap cleanup EXIT
NPM_CONFIG_CACHE="${TMP_NPM_CACHE}" sam build \
  --template-file "${SAM_TEMPLATE}" \
  --region "${REGION}" \
  --no-cached

echo "Deploying stack ${STACK_NAME} to ${REGION} (profile: ${PROFILE})..."
sam deploy \
  --stack-name "${STACK_NAME}" \
  --config-env "${SAM_CONFIG_ENV}" \
  --capabilities CAPABILITY_IAM \
  --profile "${PROFILE}" \
  --region "${REGION}" \
  --no-fail-on-empty-changeset \
  --force-upload

echo "Deployment finished."
