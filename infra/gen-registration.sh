#!/usr/bin/env bash
# Generate the real appservice registration from the template with fresh
# credentials (plan 002 M0). Idempotent: refuses to overwrite an existing
# registration unless --force, because rotating tokens invalidates the
# homeserver ↔ appservice pairing.
set -euo pipefail
cd "$(dirname "$0")"

OUT=serve-appservice.yaml
if [[ -f "$OUT" && "${1:-}" != "--force" ]]; then
  echo "$OUT exists — tokens unchanged (use --force to rotate)." >&2
  exit 0
fi

AS_TOKEN=$(openssl rand -hex 32)
HS_TOKEN=$(openssl rand -hex 32)
APP_PORT="${APP_PORT:-4010}"
sed -e "s/__AS_TOKEN__/${AS_TOKEN}/" -e "s/__HS_TOKEN__/${HS_TOKEN}/" \
    -e "s/__APP_PORT__/${APP_PORT}/" \
  serve-appservice.example.yaml > "$OUT"
chmod 600 "$OUT"
echo "wrote $OUT (as_token/hs_token rotated; app port ${APP_PORT})"
