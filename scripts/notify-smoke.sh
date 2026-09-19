#!/bin/bash
# The notification smoke: log in as a school admin, send one real email and one
# real WhatsApp through the SAME paths the product uses, then read the ledgers.
#
#   scripts/notify-smoke.sh <API> <HOST> <ADMIN_EMAIL> <TO_EMAIL> <TO_PHONE>
#   e.g. scripts/notify-smoke.sh https://api.test.sckools.com raffles.test.sckools.com admin@raffles.test you@gmail.com 6378019877
#
# The admin password is read from $SCKOOLS_ADMIN_PASSWORD (never an argument —
# arguments show in `ps` and shell history).
set -u
API=${1:?api base}; HOST=${2:?school host}; ADMIN=${3:?admin email}; TO_EMAIL=${4:?email to test}; TO_PHONE=${5:?phone to test}
PASS=${SCKOOLS_ADMIN_PASSWORD:?set SCKOOLS_ADMIN_PASSWORD}
j() { python3 -c "import sys,json; d=json.load(sys.stdin); $1"; }

TOK=$(curl -s -X POST "$API/auth/login" -H 'Content-Type: application/json' -H "X-Skoolos-Host: $HOST" -H 'X-Skoolos-Client: native' \
  -d "{\"identifier\":\"$ADMIN\",\"password\":\"$PASS\"}" | j 'print(d.get("accessToken",""))')
[ -z "$TOK" ] && { echo "login failed for $ADMIN on $HOST"; exit 1; }
H=(-H "Authorization: Bearer $TOK" -H "X-Skoolos-Host: $HOST" -H 'Content-Type: application/json')

echo "== email: test send to $TO_EMAIL"
curl -s -X POST "$API/manage/email-settings/test" "${H[@]}" -d "{\"to\":\"$TO_EMAIL\"}" | j 'print(" ", json.dumps({k:d.get(k) for k in ["ok","error","sent"] if k in d}))'
echo "== email: pre-check verdicts"
for e in "$TO_EMAIL" "ravi@gmial.com" "nobody@this-domain-does-not-exist-9x7.in"; do
  curl -s -X POST "$API/manage/email-check" "${H[@]}" -d "{\"email\":\"$e\"}" | j "print('  ', d['normalized'], '→', d['words'])"
done
echo "== email: ledger (last 5)"
curl -s "$API/manage/email-settings" "${H[@]}" | j 'ds=d.get("deliveries",{}); print("  this month:", ds.get("thisMonth")); [print("  ", r["createdAt"][11:16], r["kind"], r["to"], r["status"], r.get("error") or "") for r in ds.get("recent",[])[:5]]; print("  addresses to fix:", [s["email"] for s in ds.get("suppressed",[])])'

echo "== whatsapp: state"
curl -s "$API/manage/whatsapp-settings" "${H[@]}" | j 'print("  enabled:", d["settings"]["enabled"], "| platform configured:", d["platform"]["configured"], "| this month:", d["thisMonth"])'
echo "== whatsapp: test send to $TO_PHONE"
curl -s -X POST "$API/manage/whatsapp-settings/test" "${H[@]}" -d "{\"to\":\"$TO_PHONE\"}" | j 'print("  ok:", d.get("ok"), "phone:", d.get("phone"), d.get("message",""))'
echo "== whatsapp: ledger (last 5)"
curl -s "$API/manage/whatsapp-settings" "${H[@]}" | j '[print("  ", r["createdAt"][11:16], r["kind"], r["phone"], r["status"], r.get("error") or "") for r in d["recent"][:5]]'
