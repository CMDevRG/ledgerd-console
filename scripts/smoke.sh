#!/usr/bin/env bash
# End-to-end check of the running stack, through the console as a browser would use it, plus
# what must not be possible: create accounts, deposit twice (a replay), overdraw (refused),
# reconcile, and check that the API key is nowhere a browser could see it.
#
#   scripts/smoke.sh                  # uses .env and http://127.0.0.1:${CONSOLE_PORT:-8787}
#   BASE_URL=http://127.0.0.1:8787 LEDGERD_API_KEY=... scripts/smoke.sh
set -euo pipefail

cd "$(dirname "$0")/.."
if [ -f .env ]; then set -a; . ./.env; set +a; fi
: "${LEDGERD_API_KEY:?LEDGERD_API_KEY is required (run 'make env' first)}"
PORT="${CONSOLE_PORT:-8787}"
BASE_URL="${BASE_URL:-http://127.0.0.1:$PORT}"
LEDGERD_DIRECT="${LEDGERD_DIRECT:-http://127.0.0.1:${LEDGERD_PORT:-8085}}"
SUFFIX="$(date +%s)-$RANDOM"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }
step() { printf '  %-72s' "$1"; }
ok()   { echo "ok"; }

# call METHOD PATH [BODY [extra curl args...]] -> prints "<status>\n<body>". PATH is ledgerd's
# (/v1/...); the call goes through the console, which serves it under /api.
# Writes the response headers to $WORK/headers.
call() {
  local method=$1 path=$2 body=${3:-}
  shift $(( $# >= 3 ? 3 : $# ))
  local args=(-sS -X "$method" "$BASE_URL/api$path" -D "$WORK/headers" -w '\n%{http_code}')
  if [ "$method" != GET ]; then args+=(-H 'X-Ledgerd-Console: 1'); fi
  if [ -n "$body" ]; then args+=(-H 'Content-Type: application/json' --data "$body"); fi
  curl "${args[@]}" "$@"
}
status() { tail -n1; }
body()   { sed '$d'; }
field()  { python3 -c 'import json,sys; print(json.load(sys.stdin)[sys.argv[1]])' "$1"; }

echo "Smoke test against $BASE_URL"

step "the console is up and healthy"
[ "$(curl -sS -o /dev/null -w '%{http_code}' "$BASE_URL/healthz")" = 200 ] || fail "/healthz is not 200"
ok

step "and ledgerd is ready, seen through the console"
[ "$(curl -sS -o /dev/null -w '%{http_code}' "$BASE_URL/api/readyz")" = 200 ] || fail "/api/readyz is not 200"
ok

step "the page is served, with a strict Content Security Policy"
curl -sS -D "$WORK/page.headers" -o "$WORK/index.html" "$BASE_URL/"
grep -q '<div id="root">' "$WORK/index.html" || fail "/ is not the web application"
grep -qi "^content-security-policy: default-src 'self'; script-src 'self'" "$WORK/page.headers" || fail "no strict Content-Security-Policy"
grep -qi '^x-frame-options: DENY' "$WORK/page.headers" || fail "no X-Frame-Options"
! grep -qi '<script>' "$WORK/index.html" || fail "the page has an inline script"
ok

step "every file the page loads is served, and a deep link gets the page"
for ref in $(grep -oE '(src|href)="/[^"]+"' "$WORK/index.html" | sed -E 's/^(src|href)="//; s/"$//'); do
  code="$(curl -sS -o "$WORK/asset" -w '%{http_code}' "$BASE_URL$ref")"
  [ "$code" = 200 ] || fail "$ref answered $code"
  cp "$WORK/asset" "$WORK/asset.$(echo "$ref" | tr '/' '_')"
done
[ "$(curl -sS -o /dev/null -w '%{http_code}' "$BASE_URL/accounts/3f2b8a52-2f8e-4c61-9a4e-0d6f4f0e7c11")" = 200 ] || fail "deep link not served"
[ "$(curl -sS -o /dev/null -w '%{http_code}' "$BASE_URL/assets/missing.js")" = 404 ] || fail "a missing asset must be 404, not the page"
ok

step "the API key is in no file a browser receives"
if grep -rlF -- "$LEDGERD_API_KEY" "$WORK"/index.html "$WORK"/asset.* "$WORK"/page.headers 2>/dev/null; then fail "the API key is in what the browser receives"; fi
ok

step "create two accounts through the console"
A=$(call POST /v1/accounts "{\"code\":\"smoke-$SUFFIX-bank\",\"currency\":\"USD\",\"type\":\"ASSET\",\"normal_balance\":\"DEBIT\",\"allow_negative\":true}")
[ "$(echo "$A" | status)" = 201 ] || fail "create bank: $(echo "$A" | body)"
BANK=$(echo "$A" | body | field id)
W=$(call POST /v1/accounts "{\"code\":\"smoke-$SUFFIX-wallet\",\"currency\":\"USD\",\"type\":\"LIABILITY\",\"normal_balance\":\"CREDIT\",\"allow_negative\":false}")
[ "$(echo "$W" | status)" = 201 ] || fail "create wallet: $(echo "$W" | body)"
WALLET=$(echo "$W" | body | field id)
ok

DEPOSIT="{\"postings\":[{\"account_id\":\"$BANK\",\"direction\":\"DEBIT\",\"amount\":\"10000\",\"currency\":\"USD\"},{\"account_id\":\"$WALLET\",\"direction\":\"CREDIT\",\"amount\":\"10000\",\"currency\":\"USD\"}]}"

step "deposit 100.00"
D=$(call POST /v1/transactions "$DEPOSIT" -H "Idempotency-Key: smoke-$SUFFIX-1")
[ "$(echo "$D" | status)" = 201 ] || fail "deposit: $(echo "$D" | body)"
TX=$(echo "$D" | body | field id)
ok

step "the same request again is a replay, not a second deposit"
R=$(call POST /v1/transactions "$DEPOSIT" -H "Idempotency-Key: smoke-$SUFFIX-1")
[ "$(echo "$R" | status)" = 201 ] || fail "replay: $(echo "$R" | body)"
grep -qi '^idempotent-replayed: true' "$WORK/headers" || fail "no Idempotent-Replayed header"
[ "$(echo "$R" | body | field id)" = "$TX" ] || fail "the replay returned another transaction"
B=$(call GET "/v1/accounts/$WALLET")
[ "$(echo "$B" | body | field balance)" = 10000 ] || fail "balance is not 10000 after the replay"
ok

step "an overdraft is refused and changes nothing"
O=$(call POST /v1/transactions "{\"postings\":[{\"account_id\":\"$WALLET\",\"direction\":\"DEBIT\",\"amount\":\"10100\",\"currency\":\"USD\"},{\"account_id\":\"$BANK\",\"direction\":\"CREDIT\",\"amount\":\"10100\",\"currency\":\"USD\"}]}" -H "Idempotency-Key: smoke-$SUFFIX-2")
[ "$(echo "$O" | status)" = 422 ] || fail "overdraft was not refused"
[ "$(echo "$O" | body | field code)" = insufficient_funds ] || fail "wrong code: $(echo "$O" | body)"
[ "$(call GET "/v1/accounts/$WALLET" | body | field balance)" = 10000 ] || fail "balance changed"
ok

step "reverse the deposit"
V=$(call POST "/v1/transactions/$TX/reverse" "" -H "Idempotency-Key: smoke-$SUFFIX-3")
[ "$(echo "$V" | status)" = 201 ] || fail "reverse: $(echo "$V" | body)"
[ "$(call GET "/v1/accounts/$WALLET" | body | field balance)" = 0 ] || fail "balance is not 0 after the reversal"
ok

step "a deep reconciliation finds the ledger consistent"
C=$(call POST "/v1/reconciliations?deep=true")
[ "$(echo "$C" | status)" = 200 ] || fail "reconcile: $(echo "$C" | body)"
[ "$(echo "$C" | body | field ok)" = True ] || fail "reconciliation reports problems: $(echo "$C" | body)"
ok

step "a request from another site (forged Origin) is refused"
[ "$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$BASE_URL/api/v1/accounts" -H 'X-Ledgerd-Console: 1' -H 'Origin: https://evil.example' -H 'Content-Type: application/json' --data '{}')" = 403 ] || fail "expected 403"
ok

step "a write without the console's header is refused"
[ "$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$BASE_URL/api/v1/accounts" -H 'Content-Type: application/json' --data '{}')" = 403 ] || fail "expected 403"
ok

step "a Host the console does not serve is refused (DNS rebinding)"
[ "$(curl -sS -o /dev/null -w '%{http_code}' -H 'Host: evil.example' "$BASE_URL/healthz")" = 421 ] || fail "expected 421"
ok

step "only the allow-listed API is reachable"
for path in /api/healthz /api/v1/admin /api/metrics; do
  [ "$(curl -sS -o /dev/null -w '%{http_code}' "$BASE_URL$path")" = 404 ] || fail "$path is reachable"
done
[ "$(curl -sS -o /dev/null -w '%{http_code}' -X DELETE "$BASE_URL/api/v1/accounts/$WALLET" -H 'X-Ledgerd-Console: 1')" = 405 ] || fail "DELETE is allowed"
ok

step "ledgerd itself still refuses requests without the key"
[ "$(curl -sS -o /dev/null -w '%{http_code}' "$LEDGERD_DIRECT/v1/accounts/$WALLET")" = 401 ] || fail "ledgerd answered without a key"
ok

if command -v docker >/dev/null 2>&1 && docker compose ps --status running console >/dev/null 2>&1; then
  step "the console's log does not contain the API key"
  if docker compose logs console 2>&1 | grep -qF -- "$LEDGERD_API_KEY"; then fail "the API key is in the console log"; fi
  ok
fi

echo "All checks passed."
