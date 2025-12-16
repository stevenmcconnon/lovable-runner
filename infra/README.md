# AI SiteMaker Runner Infrastructure

Infrastructure-as-code for the AI SiteMaker backend lives in `infra/` and is expressed with AWS SAM/CloudFormation (template: `infra/template.yaml`). It provisions the HTTP API, Lambda, Cognito auth, PostgreSQL, and the supporting buckets/secrets. This README walks teammates through what ships, how to deploy it, and how to validate it even if the UI isn’t available.

## What the stack creates
- HTTP API Gateway (`prod` stage) wired to the runner Lambda (`dist/lambda.handler`).
- Optional custom domain + ACM cert for the API.
- Cognito user pool with three groups (`user`, `admin`, `super-admin`) and two app clients (interactive + machine-to-machine).
- PostgreSQL (RDS) with a Secrets Manager entry for credentials, plus a security group/subnet group targeting your VPC.
- S3 buckets for generated site bundles (`DeployBucket`) and uploaded templates (`TemplateUploadBucket`).
- Private Lambda subnets + a NAT gateway with a fixed Elastic IP so outbound calls can be IP-restricted (Namecheap, Stripe webhooks, etc).
- Optional Namecheap automation wiring so the API can check/register domains directly from customers.
- Environment wiring for Stripe, Gemini/OpenAI models, preview domain, and feature flags (`SITE_BUILDER_API_ENABLED`, `SITE_DOCS_TOKEN`).

## Prerequisites
- AWS CLI and SAM CLI installed and authenticated to the target account.
- Node 20+ and npm (for rebuilding the Lambda bundle) and `make` (SAM uses the repo makefile).
- An S3 bucket to hold generated sites (`DeployBucket`) and one for uploaded templates.
- VPC id + two subnet ids for the RDS subnet group, plus a CIDR that can reach port 5432 (lock this down for production).
- A public subnet id in that VPC that already routes to an internet gateway (where the NAT gateway will live) and two unused CIDR blocks inside the VPC for the Lambda-only private subnets.
- Namecheap credentials (API user + key + account username) if you plan to let customers search/purchase domains without leaving the app.
- Optional: ACM cert in `us-east-1` if you want a custom API domain.

## Quick deploy
Set the parameters that differ from defaults, then run the helper script:
```bash
export SAM_STACK_NAME=lovable-runner-api        # or your stack name
export SAM_DEPLOY_BUCKET=my-sites-bucket        # required
export SAM_API_DOMAIN=api.ai-sitemaker.com      # optional
export SAM_CERT_ARN=arn:aws:acm:us-east-1:...   # required only when SAM_API_DOMAIN is set

sam build --template-file infra/template.yaml
sam deploy \
  --stack-name "$SAM_STACK_NAME" \
  --template-file infra/template.yaml \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides \
    DeployBucket="$SAM_DEPLOY_BUCKET" \
    TemplateUploadBucket="$SAM_DEPLOY_BUCKET" \
    StripeSecretKey='<stripe-secret-key>' \
    StripeWebhookSecret='<stripe-webhook-secret>' \
    ApiCustomDomainName="$SAM_API_DOMAIN" \
    ApiCertificateArn="$SAM_CERT_ARN" \
    DBPassword='<strong-password>' \
    DbVpcId='vpc-xxxx' \
    DbSubnetIds='subnet-a,subnet-b' \
    DbAllowedCidr='1.2.3.4/32' \
    NatGatewaySubnetId='subnet-public-for-nat' \
    LambdaPrivateSubnetACidr='172.31.96.0/20' \
    LambdaPrivateSubnetBCidr='172.31.112.0/20' \
    NamecheapApiUser='aisitemaker' \
    NamecheapApiKey='<namecheap-api-key>' \
    NamecheapUsername='aisitemaker' \
    NamecheapApiBase='https://api.namecheap.com/xml.response'
```
Notes:
- `DBPassword` is required; other DB parameters have defaults (`DBName=aisitemaker`, `DBUsername=lovable_runner`, `DBInstanceClass=db.t4g.micro`, `DBAllocatedStorage=20`).
- `TemplateUploadBucket` can reuse `DeployBucket` (as above) or point to a dedicated bucket for uploaded templates.
- Stripe keys are required and should correspond to the same mode (test vs live) as your front-end Stripe integration.
- `GeminiApiKey`/`OpenAIApiKey` can be passed directly or via Secrets Manager ARNs (`GeminiApiKeySecretArn`/`OpenAIApiKeySecretArn`).
- `PreviewDomainName` is optional and adds CloudFront-style preview URLs.
- `NamecheapApiUser` + `NamecheapApiKey` enable the `/domains` flows to call Namecheap directly. Leave them blank to keep the legacy stub registrar.
- `StaticEgressIpAddress` is exported as a stack output—hand this Elastic IP to upstream providers (Namecheap) when they need a fixed source address.

## Apply the database schema
After the stack is up, seed the database using `infra/db/schema.sql`.
```bash
STACK=lovable-runner-api
aws cloudformation describe-stacks --stack-name "$STACK" --query "Stacks[0].Outputs" --output table
aws secretsmanager get-secret-value --secret-id "${STACK}-db-credentials" --query SecretString --output text > /tmp/db.json

DB_HOST=$(jq -r .host /tmp/db.json)
DB_USER=$(jq -r .username /tmp/db.json)
DB_PASS=$(jq -r .password /tmp/db.json)
DB_NAME=$(jq -r .database /tmp/db.json)

PGPASSWORD="$DB_PASS" psql "host=$DB_HOST user=$DB_USER dbname=$DB_NAME sslmode=require" -f infra/db/schema.sql
```
The schema creates profiles, subscriptions/usage tracking, site generations, domains, and deployment tracking tables.

## Custom domain + DNS (optional)
1) Request a cert in `us-east-1`:
```bash
scripts/request-cert.sh api.ai-sitemaker.com
```
Validate the DNS records in Route 53.  
2) Deploy the stack with `ApiCustomDomainName` + `ApiCertificateArn` set.  
3) Point DNS to API Gateway:
```bash
API_DOMAIN_NAME=api.ai-sitemaker.com scripts/create-api-alias.sh <hosted-zone-id>
```

## Validating the deployment (no UI required)
- Grab outputs to confirm endpoints and DB host:
```bash
STACK=lovable-runner-api
aws cloudformation describe-stacks --stack-name "$STACK" --query "Stacks[0].Outputs"
```
- Retrieve the static Lambda egress IP (same output call as above) to whitelist it with vendors:
  ```bash
  aws cloudformation describe-stacks --stack-name "$STACK" \
    --query "Stacks[0].Outputs[?OutputKey=='StaticEgressIpAddress'].[OutputValue]" \
    --output text
  ```
- Health check the API: `curl https://<api-domain-or-endpoint>/health`.
- Smoke test the endpoints:
  - If you already have Cognito tokens, export `TEST_CUSTOMER_TOKEN` and `TEST_ADMIN_TOKEN`.
  - Otherwise run with a throwaway user (creates/deletes it automatically):
    ```bash
    TEST_STACK_NAME="$STACK" TEST_BOOTSTRAP_USER=1 npm run test:api
    ```
    This script discovers the DB endpoint/secret, seeds the schema if needed, signs into Cognito, calls the protected routes, and cleans up the temp user/profile.
- Manual launch test (requires `DeployBucket` write access): `curl -X POST https://<api>/launch -H "Content-Type: application/json" -d '{"url":"https://example.com","bucket":"<bucket>","prefix":"lovable"}'`.

## Git workflow guardrails
- Keep infra edits in `infra/` and run `sam validate` before opening a PR.
- Include the parameter set you used in PR notes (stack name, buckets, VPC/subnets, domain/cert, model API keys).
- For reviewability, attach the CloudFormation change set diff (`sam deploy --no-execute-changeset`) and the output of `npm run test:api` (or note why it was skipped).

## Cleanup
To remove everything created by the stack:
```bash
sam delete --stack-name lovable-runner-api
```
Remember to clean up any custom DNS records and delete data in the `DeployBucket`/`TemplateUploadBucket` if they are shared.
