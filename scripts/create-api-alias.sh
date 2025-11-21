#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <hosted-zone-id>" >&2
  exit 1
fi

: "${API_DOMAIN_NAME:?Set API_DOMAIN_NAME to the custom domain (e.g., api.ai-sitemaker.com)}"

HOSTED_ZONE_ID="$1"

TARGET=$(aws apigatewayv2 get-domain-names \
  --query "DomainNames[?DomainName=='$API_DOMAIN_NAME'].DomainNameConfigurations[0].ApiGatewayDomainName" \
  --output text)

if [[ -z "$TARGET" || "$TARGET" == "None" ]]; then
  echo "Could not find API Gateway domain for $API_DOMAIN_NAME" >&2
  exit 1
fi

CHANGE_BATCH=$(cat <<EOF
{
  "Comment": "Alias for $API_DOMAIN_NAME -> $TARGET",
  "Changes": [
    {
      "Action": "UPSERT",
      "ResourceRecordSet": {
        "Name": "$API_DOMAIN_NAME",
        "Type": "A",
        "AliasTarget": {
          "HostedZoneId": "Z2FDTNDATAQYW2",
          "DNSName": "$TARGET",
          "EvaluateTargetHealth": false
        }
      }
    }
  ]
}
EOF
)

aws route53 change-resource-record-sets \
  --hosted-zone-id "$HOSTED_ZONE_ID" \
  --change-batch "$CHANGE_BATCH"

echo "Alias record submitted for $API_DOMAIN_NAME -> $TARGET (Zone: $HOSTED_ZONE_ID)"
