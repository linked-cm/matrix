#!/usr/bin/env bash
# Plan 002 M0 spike — boot the homeserver and PROVE the appservice contract:
#   1. container healthy (/versions)
#   2. one-time bootstrap admin registered (secret-token gated)
#   3. appservice registration submitted through the admin room (Continuwuity
#      stores registrations in RocksDB, not a config file — this scripts the
#      "manual" step so provisioning stays reproducible)
#   4. as_token puppeting works end-to-end: register puppet user, create a
#      private room, send a message, read it back.
# Idempotent: safe to re-run; secrets live in .matrix-secrets (gitignored).
set -euo pipefail
cd "$(dirname "$0")"
HS=http://127.0.0.1:4148
# Pin the compose PROJECT so bootstrap and provision share one container/
# volume namespace (provision uses -p serve-community; a bare -f here would
# derive project "deploy" and fork the homeserver state).
COMPOSE="docker compose -p serve-community -f ../deploy/docker-compose.yml"

# ── secrets ────────────────────────────────────────────────────────────────
if [[ ! -f .matrix-secrets ]]; then
  {
    echo "MATRIX_REGISTRATION_TOKEN=$(openssl rand -hex 16)"
    echo "MATRIX_ADMIN_PASSWORD=$(openssl rand -hex 16)"
  } > .matrix-secrets
  chmod 600 .matrix-secrets
  echo "generated .matrix-secrets"
fi
# shellcheck disable=SC1091
source .matrix-secrets
# Compose auto-loads infra/deploy/.env — persist the token there so EVERY
# compose invocation (incl. provision's fuseki-only ups) satisfies the
# `${MATRIX_REGISTRATION_TOKEN:?}` guard without hand-exported env.
if ! grep -q '^MATRIX_REGISTRATION_TOKEN=' ../deploy/.env 2>/dev/null; then
  echo "MATRIX_REGISTRATION_TOKEN=${MATRIX_REGISTRATION_TOKEN}" >> ../deploy/.env
  chmod 600 ../deploy/.env
fi
./gen-registration.sh
AS_TOKEN=$(grep '^as_token' serve-appservice.yaml | cut -d'"' -f2)

# ── 1. boot ────────────────────────────────────────────────────────────────
MATRIX_REGISTRATION_TOKEN="$MATRIX_REGISTRATION_TOKEN" $COMPOSE up -d matrix
for i in $(seq 1 30); do
  curl -sf -m 3 "$HS/_matrix/client/versions" >/dev/null && break
  sleep 2
done
curl -sf "$HS/_matrix/client/versions" | head -c 120; echo
echo "✓ homeserver up"

# ── 2. bootstrap admin (UIA registration-token flow) ───────────────────────
login() {
  curl -s "$HS/_matrix/client/v3/login" -X POST -d \
    "{\"type\":\"m.login.password\",\"identifier\":{\"type\":\"m.id.user\",\"user\":\"serve-admin\"},\"password\":\"$MATRIX_ADMIN_PASSWORD\"}"
}
ADMIN_TOKEN=$(login | python3 -c "import json,sys; print(json.load(sys.stdin).get('access_token',''))" || true)
register_with() {
  local tok=$1
  local session
  session=$(curl -s "$HS/_matrix/client/v3/register" -X POST -d '{"username":"serve-admin"}' \
    | python3 -c "import json,sys; print(json.load(sys.stdin).get('session',''))")
  curl -s "$HS/_matrix/client/v3/register" -X POST -d \
    "{\"username\":\"serve-admin\",\"password\":\"$MATRIX_ADMIN_PASSWORD\",\"auth\":{\"type\":\"m.login.registration_token\",\"token\":\"$tok\",\"session\":\"$session\"}}" \
    | python3 -c "import json,sys; print(json.load(sys.stdin).get('access_token',''))"
}
if [[ -z "$ADMIN_TOKEN" ]]; then
  ADMIN_TOKEN=$(register_with "$MATRIX_REGISTRATION_TOKEN")
fi
if [[ -z "$ADMIN_TOKEN" ]]; then
  # First boot: Continuwuity mints a ONE-TIME token into its logs and the
  # configured token is inert until the first account exists (verified
  # v26.7.1). Scrape it and register the bootstrap admin with it.
  BOOT_TOKEN=$(docker logs serve-community-matrix 2>&1 \
    | sed 's/\x1b\[[0-9;]*m//g' \
    | grep -o "using the registration token [^ ]*" | tail -1 | awk '{print $5}')
  [[ -n "$BOOT_TOKEN" ]] && ADMIN_TOKEN=$(register_with "$BOOT_TOKEN")
fi
[[ -n "$ADMIN_TOKEN" ]] || { echo "✗ bootstrap admin failed"; exit 1; }
echo "✓ bootstrap admin ready"

# ── 3. register the appservice via the admin room ──────────────────────────
if curl -s "$HS/_matrix/client/v3/register" -X POST \
     -H "Authorization: Bearer $AS_TOKEN" \
     -d '{"type":"m.login.application_service","username":"serve"}' \
     | grep -q 'M_UNKNOWN_TOKEN\|M_FORBIDDEN\|M_UNAUTHORIZED'; then
  # The first admin is INVITED to the admin room, not joined — resolve the
  # #admins alias, join, send the command, and verify the bot's reply.
  ADMIN_ROOM=$(curl -s "$HS/_matrix/client/v3/directory/room/%23admins%3Aserve.create.now" \
    | python3 -c "import json,sys; print(json.load(sys.stdin).get('room_id',''))")
  [[ -n "$ADMIN_ROOM" ]] || { echo "✗ could not resolve #admins alias"; exit 1; }
  curl -s "$HS/_matrix/client/v3/join/$ADMIN_ROOM" -X POST \
    -H "Authorization: Bearer $ADMIN_TOKEN" -d '{}' >/dev/null
  python3 - "$HS" "$ADMIN_TOKEN" "$ADMIN_ROOM" <<'PY'
import json, sys, time, urllib.request, urllib.parse
hs, token, room = sys.argv[1:4]
yaml = open('serve-appservice.yaml').read()
body = f"!admin appservices register\n```\n{yaml}\n```"
req = urllib.request.Request(
    f"{hs}/_matrix/client/v3/rooms/{urllib.parse.quote(room)}/send/m.room.message/{int(time.time()*1000)}",
    data=json.dumps({"msgtype": "m.text", "body": body}).encode(),
    headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    method="PUT")
assert urllib.request.urlopen(req).status == 200
time.sleep(2)
req = urllib.request.Request(
    f"{hs}/_matrix/client/v3/rooms/{urllib.parse.quote(room)}/messages?dir=b&limit=3",
    headers={"Authorization": f"Bearer {token}"})
chunk = json.load(urllib.request.urlopen(req))["chunk"]
replies = [e["content"].get("body", "") for e in chunk
           if e.get("type") == "m.room.message" and e["sender"] != "@serve-admin:serve.create.now"]
print("admin bot reply:", (replies[0][:160] if replies else "(none)"))
PY
  echo "✓ appservice registration submitted via admin room"
fi

# ── 4. prove as_token puppeting end-to-end ─────────────────────────────────
AS_H="Authorization: Bearer $AS_TOKEN"
curl -s "$HS/_matrix/client/v3/register" -X POST -H "$AS_H" \
  -d '{"type":"m.login.application_service","username":"p_m0spike"}' >/dev/null || true
ROOM=$(curl -s "$HS/_matrix/client/v3/createRoom?user_id=@p_m0spike:serve.create.now" \
  -X POST -H "$AS_H" -d '{"preset":"private_chat","name":"M0 spike"}' \
  | python3 -c "import json,sys; print(json.load(sys.stdin).get('room_id',''))")
[[ -n "$ROOM" ]] || { echo "✗ createRoom as puppet failed"; exit 1; }
TXN="m0-$(date +%s)"
curl -s "$HS/_matrix/client/v3/rooms/$ROOM/send/m.room.message/$TXN?user_id=@p_m0spike:serve.create.now" \
  -X PUT -H "$AS_H" -d '{"msgtype":"m.text","body":"M0 spike: puppeted send works"}' >/dev/null
BODY=$(curl -s "$HS/_matrix/client/v3/rooms/$ROOM/messages?dir=b&limit=10&user_id=@p_m0spike:serve.create.now" \
  -H "$AS_H" | python3 -c "
import json, sys
for e in json.load(sys.stdin)['chunk']:
    body = e.get('content', {}).get('body')
    if body: print(body); break")
[[ "$BODY" == "M0 spike: puppeted send works" ]] || { echo "✗ message round-trip failed"; exit 1; }
echo "✓ appservice puppeting proven: register + createRoom + send + read-back"
echo "M0 ACCEPTANCE PASSED"
