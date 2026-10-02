#!/bin/bash
#
# Adds a sample-pack file to a server's pack library — the same three calls the
# owner console's "Upload a pack" button makes, with the real status of each one
# printed, so a failure says WHICH step failed and why.
#
#   bash apps/api/scripts/sample-pack/upload.sh [file] [name]
#
# It asks for your owner login with a hidden prompt (nothing is echoed, saved or
# sent anywhere except that server's own login endpoint). Leave the email blank to
# use the owner gate password instead.
#
# Environment (defaults are staging):
#   API=https://api.test.sckools.com   OWNER_HOST=owner.test.sckools.com
set -uo pipefail

API="${API:-https://api.test.sckools.com}"
HOST="${OWNER_HOST:-owner.test.sckools.com}"
FILE="${1:-$HOME/Downloads/sckools-sample-packs/sample-school-nursery-xii.sckools}"
NAME="${2:-Sample School - Nursery to XII}"
NOTES="1,138 students across 15 grades x 3 sections, 20 teachers, four months of attendance, fees, salary, exams, library, events and leave. Every login password is: password"

[ -f "$FILE" ] || { echo "No such file: $FILE"; exit 1; }
SIZE=$(wc -c < "$FILE" | tr -d ' ')
echo "Pack: $FILE ($((SIZE / 1024 / 1024)) MB) as \"$NAME\" on $API"

# The sign-in prompts need a real keyboard. Piped, or run from a tool that cannot
# pass typed input, they read nothing and the server answers with a confusing
# "password must be longer than 1 character". Say so plainly instead.
if [ ! -t 0 ]; then
  echo "This asks for your password, so it must be run in a normal Terminal window"
  echo "(not from a tool that cannot pass typed input). Open Terminal and run:"
  echo "    bash $0"
  exit 1
fi

read -r -p "Owner email (blank = gate password): " EMAIL
read -r -s -p "Password: " PASS; echo
[ -n "$PASS" ] || { echo "No password entered."; exit 1; }
TOTP=""
if [ -n "$EMAIL" ]; then read -r -p "6-digit code (blank if you have no MFA): " TOTP; fi

json() { python3 -c "import json,sys; print(json.dumps(dict(a.split('=',1) for a in sys.argv[1:] if '=' in a)))" "$@"; }
field() { python3 -c "
import sys,json
try: d=json.load(sys.stdin)
except Exception: sys.exit(0)
def find(o,k):
    if isinstance(o,dict):
        if k in o: return o[k]
        for v in o.values():
            r=find(v,k)
            if r is not None: return r
    return None
v=find(d,'$1'); print(v if v is not None else '')"; }

# ── 1. sign in ──────────────────────────────────────────────────────────────
if [ -n "$EMAIL" ]; then
  BODY=$(json "email=$EMAIL" "password=$PASS" ${TOTP:+"totp=$TOTP"}); URL="$API/owner/auth/login"
else
  BODY=$(json "password=$PASS"); URL="$API/owner/auth/gate"
fi
R=$(curl -s -X POST "$URL" -H "X-Skoolos-Host: $HOST" -H 'Content-Type: application/json' -d "$BODY")
TOKEN=$(printf '%s' "$R" | field accessToken)
unset PASS BODY
if [ -z "$TOKEN" ]; then echo "1. Sign-in FAILED: $(printf '%s' "$R" | field message) ($(printf '%s' "$R" | field code))"; exit 1; fi
echo "1. Signed in."
AUTH=(-H "Authorization: Bearer $TOKEN" -H "X-Skoolos-Host: $HOST" -H 'Content-Type: application/json')

# ── 2. ask the server where to put the file ─────────────────────────────────
R=$(curl -s -X POST "$API/owner/sample-packs/upload-url" "${AUTH[@]}")
KEY=$(printf '%s' "$R" | field key); PUT=$(printf '%s' "$R" | field url)
if [ -z "$KEY" ] || [ -z "$PUT" ]; then echo "2. Upload address FAILED: $R"; exit 1; fi
echo "2. Got an upload address ($KEY)."
if printf '%s' "$PUT" | grep -qi 'x-amz-checksum'; then
  echo "   WARNING: that address signs a checksum of an empty file — storage will refuse the real one."
  echo "   The server is still running the old code. Wait for the staging deploy to finish and run this again."
fi

# ── 3. send the file straight to storage, exactly as the browser does ───────
CODE=$(curl -s -o /tmp/pack-put.out -w '%{http_code}' -X PUT "$PUT" -H 'Content-Type: application/octet-stream' --data-binary "@$FILE")
if [ "$CODE" != "200" ]; then echo "3. Upload to storage FAILED with HTTP $CODE:"; head -c 600 /tmp/pack-put.out; echo; exit 1; fi
echo "3. File is in storage (HTTP 200)."

# ── 4. tell the server it arrived, so it checks and lists it ────────────────
BODY=$(json "key=$KEY" "name=$NAME" "notes=$NOTES")
R=$(curl -s -w '\n%{http_code}' -X POST "$API/owner/sample-packs/uploaded" "${AUTH[@]}" -d "$BODY")
CODE=$(printf '%s' "$R" | tail -n1); R=$(printf '%s' "$R" | sed '$d')
if [ "$CODE" != "201" ] && [ "$CODE" != "200" ]; then echo "4. Registering FAILED with HTTP $CODE: $R"; exit 1; fi
echo "4. Checked and added: $(printf '%s' "$R" | field name) — status $(printf '%s' "$R" | field status), $(printf '%s' "$R" | field rowCount) rows, $(printf '%s' "$R" | field tableCount) tables."

echo; echo "In the library now:"
curl -s "$API/owner/sample-packs" "${AUTH[@]}" | python3 -c "
import sys,json
for p in json.load(sys.stdin): print('  -', p['name'], '|', p['status'], '|', p.get('rowCount'), 'rows')"
rm -f /tmp/pack-put.out
