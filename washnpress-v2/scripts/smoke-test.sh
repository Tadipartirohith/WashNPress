#!/usr/bin/env bash
# End-to-end smoke test against a running instance.
# Waits for the app to become ready, so it is safe to run right after starting a
# container. Also safe to run repeatedly against the same instance.
#
# Usage: BASE_URL=http://localhost:8080 ./scripts/smoke-test.sh
set -u
B="${BASE_URL:-http://localhost:8080}"
SECRET="${WEBHOOK_SECRET:-change-me-in-config-local-or-env}"
pass=0; fail=0
chk(){ if [ "$1" = "$2" ]; then echo "  PASS: $3 ($1)"; pass=$((pass+1)); else echo "  FAIL: $3 (got '$1' want '$2')"; fail=$((fail+1)); fi; }
j(){ python3 -c "import sys,json
try:
    d=json.load(sys.stdin); print($1)
except Exception:
    print('')"; }

echo "Waiting for $B to be ready ..."
ready=0
for i in $(seq 1 60); do
  if curl -sf "$B/health" >/dev/null 2>&1; then ready=1; echo "  ready after ${i}s"; break; fi
  sleep 1
done
if [ "$ready" != "1" ]; then echo "ERROR: app at $B did not become ready in 60s"; exit 1; fi

echo "0) HEALTH"; chk "$(curl -s $B/health | j 'd["status"]')" "ok" "health live"

echo "1) RESIDENT LOGIN"
OTP=$(curl -s -X POST $B/v1/auth/otp/send -H 'content-type: application/json' -d '{"phone":"9876543210"}' | j 'd["otpForTesting"]')
RTOK=$(curl -s -X POST $B/v1/auth/otp/verify -H 'content-type: application/json' -d "{\"phone\":\"9876543210\",\"otp\":\"$OTP\"}" | j 'd["token"]')
RH="authorization: Bearer $RTOK"; [ -n "$RTOK" ] && chk ok ok "resident logged in" || chk "" ok "resident logged in"

bal(){ curl -s $B/v1/wallet -H "$RH" | j 'd["balancePaise"]'; }

echo "2) FUND WALLET (signed webhook, unique event id)"
B0=$(bal); [ -z "$B0" ] && B0=0
EVID="evt_smoke_$(date +%s)_$$"
BODY="{\"id\":\"$EVID\",\"event\":\"payment.captured\",\"payload\":{\"residentId\":\"res-demo\",\"amountPaise\":300000}}"
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')
chk "$(curl -s -o /dev/null -w '%{http_code}' -X POST $B/v1/payments/webhook -H 'content-type: application/json' -H "x-razorpay-signature: $SIG" -d "$BODY")" "200" "signed webhook accepted"
B1=$(bal); [ -z "$B1" ] && B1=0
chk "$((B1 - B0))" "300000" "wallet credited by 300000"

echo "3) FORGED WEBHOOK REJECTED"
chk "$(curl -s -o /dev/null -w '%{http_code}' -X POST $B/v1/payments/webhook -H 'content-type: application/json' -H 'x-razorpay-signature: deadbeef' -d "$BODY")" "401" "forged webhook rejected"

echo "4) SUBSCRIBE"
chk "$(curl -s -o /dev/null -w '%{http_code}' -X POST $B/v1/subscription/subscribe -H "$RH" -H 'content-type: application/json' -d '{"planId":"plan-basic","cycle":"monthly"}')" "201" "subscribed"

echo "5) BOOK PICKUP"
DATE=$(date -u +%F)
SLOT=$(curl -s "$B/v1/slots?date=$DATE" -H "$RH" | j 'd["slots"][0]["id"]')
ORD=$(curl -s -X POST $B/v1/pickups -H "$RH" -H 'content-type: application/json' -d "{\"slotId\":\"$SLOT\"}" | j 'd["order"]["id"]')
[ -n "$ORD" ] && chk ok ok "pickup booked" || chk "" ok "pickup booked"

echo "6) OPERATOR PIPELINE"
OOTP=$(curl -s -X POST $B/v1/auth/otp/send -H 'content-type: application/json' -d '{"phone":"9876500002"}' | j 'd["otpForTesting"]')
OTOK=$(curl -s -X POST $B/v1/auth/otp/verify -H 'content-type: application/json' -d "{\"phone\":\"9876500002\",\"otp\":\"$OOTP\"}" | j 'd["token"]')
OH="authorization: Bearer $OTOK"
curl -s -o /dev/null -X POST $B/v1/operations/orders/$ORD/picked-up -H "$OH" -H 'content-type: application/json' -d '{"items":[{"category":"Shirts","quantity":3},{"category":"Trousers","quantity":2}]}'
for stage in in_wash ironing qc; do curl -s -o /dev/null -X POST $B/v1/operations/orders/$ORD/advance -H "$OH" -H 'content-type: application/json' -d "{\"to\":\"$stage\"}"; done
curl -s -o /dev/null -X POST $B/v1/operations/orders/$ORD/qc -H "$OH" -H 'content-type: application/json' -d '{"pass":true}'
curl -s -o /dev/null -X POST $B/v1/operations/orders/$ORD/out-for-delivery -H "$OH"
chk "$(curl -s -X POST $B/v1/operations/orders/$ORD/deliver -H "$OH" -H 'content-type: application/json' -d '{"deliveryCount":5}' | j 'd["order"]["state"]')" "delivered" "delivered through full pipeline"

echo "7) GARMENT SPLIT IS CALCULATED BY THE BACKEND"
SLOT2=$(curl -s "$B/v1/slots?date=$DATE" -H "$RH" | j 'd["slots"][0]["id"]')
ORD2=$(curl -s -X POST $B/v1/pickups -H "$RH" -H 'content-type: application/json' -d "{\"slotId\":\"$SLOT2\"}" | j 'd["order"]["id"]')
SPLIT=$(curl -s -X POST $B/v1/operations/orders/$ORD2/garments/preview -H "$OH" -H 'content-type: application/json' -d '{"items":[{"category":"Shirts","quantity":8},{"category":"Trousers","quantity":5},{"category":"Bedsheets","quantity":4},{"category":"Other","quantity":3}]}')
chk "$(printf '%s' "$SPLIT" | j 'd["summary"]["acceptedCount"]')" "20" "accepted quantity totalled from the categories"
COVERED=$(printf '%s' "$SPLIT" | j 'd["summary"]["subscriptionCoveredCount"]')
ADDITIONAL=$(printf '%s' "$SPLIT" | j 'd["summary"]["additionalCount"]')
chk "$((COVERED + ADDITIONAL))" "20" "covered plus additional equals the accepted quantity"
curl -s -o /dev/null -X POST $B/v1/operations/orders/$ORD2/picked-up -H "$OH" -H 'content-type: application/json' -d '{"items":[{"category":"Shirts","quantity":8},{"category":"Trousers","quantity":5},{"category":"Bedsheets","quantity":4},{"category":"Other","quantity":3}]}'
# Keep collecting until the plan allowance runs out, so the overage path is proven.
OVERAGE=0
for i in 1 2 3 4 5 6; do
  SLOTN=$(curl -s "$B/v1/slots?date=$DATE" -H "$RH" | j 'd["slots"][0]["id"]')
  [ -z "$SLOTN" ] && break
  ORDN=$(curl -s -X POST $B/v1/pickups -H "$RH" -H 'content-type: application/json' -d "{\"slotId\":\"$SLOTN\"}" | j 'd["order"]["id"]')
  [ -z "$ORDN" ] && break
  BODY_N=$(curl -s -X POST $B/v1/operations/orders/$ORDN/picked-up -H "$OH" -H 'content-type: application/json' -d '{"items":[{"category":"Shirts","quantity":8},{"category":"Trousers","quantity":5},{"category":"Bedsheets","quantity":4},{"category":"Other","quantity":3}]}')
  ADDN=$(printf '%s' "$BODY_N" | j 'd["order"]["additionalCount"]')
  if [ -n "$ADDN" ] && [ "$ADDN" -gt 0 ] 2>/dev/null; then
    RATEN=$(printf '%s' "$BODY_N" | j 'd["order"]["additionalRatePaise"]')
    CHARGEN=$(printf '%s' "$BODY_N" | j 'd["order"]["additionalChargePaise"]')
    chk "$CHARGEN" "$((ADDN * RATEN))" "overage billed at the configured rate"
    OVERAGE=1
    break
  fi
done
chk "$OVERAGE" "1" "an over-allowance pickup produced an additional charge"

echo "8) ADMIN PORTAL"
AOTP=$(curl -s -X POST $B/v1/auth/otp/send -H 'content-type: application/json' -d '{"phone":"9876500001"}' | j 'd["otpForTesting"]')
ATOK=$(curl -s -X POST $B/v1/auth/otp/verify -H 'content-type: application/json' -d "{\"phone\":\"9876500001\",\"otp\":\"$AOTP\"}" | j 'd["token"]')
AH="authorization: Bearer $ATOK"
chk "$(curl -s -o /dev/null -w '%{http_code}' $B/v1/admin/dashboard -H "$AH")" "200" "admin dashboard reachable"
chk "$(curl -s $B/v1/admin/areas -H "$AH" | j 'len(d["areas"])')" "2" "admin sees every area"
chk "$(curl -s $B/v1/admin/config -H "$AH" | j 'type(d["config"]["additionalGarmentRatePaise"]).__name__')" "int" "additional garment rate is configured globally"

echo "9) SUPERVISOR PORTAL AND AREA SCOPE"
SOTP=$(curl -s -X POST $B/v1/auth/otp/send -H 'content-type: application/json' -d '{"phone":"9876500011"}' | j 'd["otpForTesting"]')
STOK=$(curl -s -X POST $B/v1/auth/otp/verify -H 'content-type: application/json' -d "{\"phone\":\"9876500011\",\"otp\":\"$SOTP\"}" | j 'd["token"]')
SH="authorization: Bearer $STOK"
chk "$(curl -s $B/v1/supervisor/dashboard -H "$SH" | j 'd["area"]["name"]')" "Madhapur" "supervisor dashboard is scoped to their area"
chk "$(curl -s $B/v1/supervisor/societies -H "$SH" | j 'str(any(s["id"]=="soc-gachibowli" for s in d["societies"])).lower()')" "false" "another area society is not listed"
chk "$(curl -s -o /dev/null -w '%{http_code}' $B/v1/supervisor/societies/soc-gachibowli -H "$SH")" "403" "another area society is refused by id"
chk "$(curl -s -o /dev/null -w '%{http_code}' $B/v1/admin/dashboard -H "$SH")" "403" "supervisor forbidden from the admin portal"

echo "10) RBAC"
chk "$(curl -s -o /dev/null -w '%{http_code}' $B/v1/admin/reports/revenue -H "$RH")" "403" "resident forbidden from admin"
chk "$(curl -s -o /dev/null -w '%{http_code}' $B/v1/supervisor/dashboard -H "$RH")" "403" "resident forbidden from supervisor portal"
chk "$(curl -s -o /dev/null -w '%{http_code}' $B/v1/operations/dashboard -H "$RH")" "403" "resident forbidden from operations portal"
chk "$(curl -s $B/v1/resident/dashboard -H "$RH" | j 'str(d["subscription"] is not None).lower()')" "true" "resident dashboard returns their own plan"

echo ""; echo "==== RESULT: $pass passed, $fail failed ===="
[ "$fail" -eq 0 ]
