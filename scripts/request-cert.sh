#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <domain-name>" >&2
  exit 1
fi

DOMAIN="$1"
IDEMPOTENCY_TOKEN="$(openssl rand -hex 6)"

aws acm request-certificate \
  --region us-east-1 \
  --domain-name "$DOMAIN" \
  --validation-method DNS \
  --idempotency-token "$IDEMPOTENCY_TOKEN" \
  --subject-alternative-names "*.$DOMAIN"

echo "Certificate requested for $DOMAIN. Run 'aws acm describe-certificate --certificate-arn <arn>' to fetch the DNS validation records."
