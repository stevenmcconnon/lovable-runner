#!/usr/bin/env bash
set -euo pipefail

# Configure these before running or export them in your shell.
: "${SAM_STACK_NAME:=lovable-runner-api}"
: "${SAM_DEPLOY_BUCKET:?Set SAM_DEPLOY_BUCKET to the S3 bucket for site assets}"
: "${SAM_DEPLOY_PREFIX:=lovable}"
: "${SAM_API_DOMAIN:=}"
: "${SAM_CERT_ARN:=}"

PARAMS=(
  "DeployBucket=$SAM_DEPLOY_BUCKET"
  "DeployPrefix=$SAM_DEPLOY_PREFIX"
)

if [[ -n "$SAM_API_DOMAIN" && -n "$SAM_CERT_ARN" ]]; then
  PARAMS+=("ApiCustomDomainName=$SAM_API_DOMAIN" "ApiCertificateArn=$SAM_CERT_ARN")
fi

sam build --template-file infra/template.yaml
sam deploy \
  --stack-name "$SAM_STACK_NAME" \
  --template-file infra/template.yaml \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides "${PARAMS[@]}"
