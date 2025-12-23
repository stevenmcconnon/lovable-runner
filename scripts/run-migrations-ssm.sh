#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: ./scripts/run-migrations-ssm.sh [options]

Runs database migrations through an SSM port-forward to the RDS (or RDS Proxy) endpoint.

Options:
  --stack <name>     CloudFormation stack name (default: lovable-runner-api)
  --profile <name>   AWS CLI profile (default: lovable)
  --target <id>      Bastion/SSM-managed instance id to tunnel through (default: $BASTION_INSTANCE_ID or i-02126f68319a162ee)
  --local-port <n>   Local port for the forward (default: 15432)
  --db-secret <arn>  SecretId/ARN for DB creds (default: ${stack}-db-credentials)
  --use-proxy        Force use of DatabaseProxyEndpoint (default: prefer DatabaseEndpoint/direct)
  --help             Show this help
EOF
}

STACK="lovable-runner-api"
PROFILE="${AWS_PROFILE:-lovable}"
TARGET="${BASTION_INSTANCE_ID:-i-02126f68319a162ee}"
LOCAL_PORT=15432
DB_SECRET=""
USE_PROXY=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --stack) STACK="$2"; shift 2;;
    --profile) PROFILE="$2"; shift 2;;
    --target) TARGET="$2"; shift 2;;
    --local-port) LOCAL_PORT="$2"; shift 2;;
    --db-secret) DB_SECRET="$2"; shift 2;;
    --use-proxy) USE_PROXY=1; shift;;
    -h|--help) usage; exit 0;;
    *) echo "Unknown option: $1" >&2; usage; exit 1;;
  esac
done

if ! command -v aws >/dev/null 2>&1; then
  echo "aws CLI is required." >&2
  exit 1
fi

echo "[migrate-ssm] Resolving DB endpoint and secret..."
DB_PROXY=$(aws cloudformation describe-stacks \
  --stack-name "$STACK" \
  --profile "$PROFILE" \
  --query "Stacks[0].Outputs[?OutputKey=='DatabaseProxyEndpoint'].OutputValue" \
  --output text 2>/dev/null || true)
DB_DIRECT=$(aws cloudformation describe-stacks \
  --stack-name "$STACK" \
  --profile "$PROFILE" \
  --query "Stacks[0].Outputs[?OutputKey=='DatabaseEndpoint'].OutputValue" \
  --output text 2>/dev/null || true)

DB_HOST="$DB_DIRECT"
if [[ "$USE_PROXY" -eq 1 || -z "$DB_DIRECT" || "$DB_DIRECT" == "None" ]]; then
  DB_HOST="$DB_PROXY"
fi

if [[ -z "$DB_HOST" || "$DB_HOST" == "None" ]]; then
  echo "Could not resolve a database endpoint from stack outputs." >&2
  exit 1
fi

SECRET_ID="${DB_SECRET:-${STACK}-db-credentials}"
SECRET_JSON=$(aws secretsmanager get-secret-value \
  --secret-id "$SECRET_ID" \
  --profile "$PROFILE" \
  --query SecretString \
  --output text)

read -r DB_USER DB_PASS DB_NAME <<<"$(SECRET_JSON="$SECRET_JSON" node -e "
const secret = JSON.parse(process.env.SECRET_JSON || '{}');
const user = secret.username || secret.user || '';
const password = secret.password || secret.pass || '';
const db = secret.database || secret.dbname || '';
const encPass = encodeURIComponent(password);
console.log(user, encPass, db);
" )"

if [[ -z "$DB_USER" || -z "$DB_NAME" ]]; then
  echo "Failed to parse DB credentials from secret ${SECRET_ID}" >&2
  exit 1
fi

echo "[migrate-ssm] Starting SSM port forward to ${DB_HOST}:5432 via ${TARGET} on localhost:${LOCAL_PORT}..."
LOG_FILE="$(mktemp -t ssm-port-forward.XXXXXX)"
LOG_FILE="${LOG_FILE}.log"
aws ssm start-session \
  --target "$TARGET" \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters host="$DB_HOST",portNumber="5432",localPortNumber="${LOCAL_PORT}" \
  --profile "$PROFILE" >"$LOG_FILE" 2>&1 &
SSM_PID=$!
echo "[migrate-ssm] Session log: $LOG_FILE (pid $SSM_PID)"

SESSION_ID=""
for _ in {1..10}; do
  SESSION_ID=$(awk '
    /SessionId/ {
      for (i = 1; i <= NF; i++) {
        if ($i ~ /SessionId:/) {print $(i+1); exit}
      }
    }' "$LOG_FILE")
  [[ -n "$SESSION_ID" ]] && break
  sleep 1
done
[[ -n "$SESSION_ID" ]] && echo "[migrate-ssm] SessionId: $SESSION_ID"

terminate_active_sessions() {
  if [[ -n "$1" ]]; then
    aws ssm terminate-session --session-id "$1" --profile "$PROFILE" >/dev/null 2>&1 || true
  fi
  ACTIVE=$(aws ssm describe-sessions --state Active --profile "$PROFILE" \
    --query "Sessions[?Target=='${TARGET}'].SessionId" --output text 2>/dev/null || true)
  if [[ -n "$ACTIVE" ]]; then
    for sid in $ACTIVE; do
      aws ssm terminate-session --session-id "$sid" --profile "$PROFILE" >/dev/null 2>&1 || true
    done
  fi
}

cleanup() {
  terminate_active_sessions "$SESSION_ID"
  if ps -p "$SSM_PID" >/dev/null 2>&1; then
    echo "[migrate-ssm] Terminating SSM session process..."
    kill "$SSM_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

for _ in {1..30}; do
  if nc -z localhost "$LOCAL_PORT" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! nc -z localhost "$LOCAL_PORT" >/dev/null 2>&1; then
  echo "[migrate-ssm] Failed to open local port; see $LOG_FILE" >&2
  exit 1
fi

export DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@127.0.0.1:${LOCAL_PORT}/${DB_NAME}?sslmode=require"
echo "[migrate-ssm] Running migrations..."
if ! timeout 240s env NODE_TLS_REJECT_UNAUTHORIZED=0 npm run db:migrate; then
  echo "[migrate-ssm] Migration command failed; see $LOG_FILE" >&2
  terminate_active_sessions "$SESSION_ID"
  exit 1
fi
terminate_active_sessions "$SESSION_ID"
echo "[migrate-ssm] Done."
