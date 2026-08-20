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
# Books until a pickup exceeds whatever allowance is left, so the check holds
# however much allowance the resident had when the run started.
OVERAGE=0
for i in 1 2 3 4 5 6 7 8; do
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
chk "$OVERAGE" "1" "a pickup beyond the allowance produced a charge"

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

echo "11) API DOCUMENTATION"
SPEC=$(curl -s $B/openapi.json)
chk "$(printf '%s' "$SPEC" | j 'd["openapi"][0]')" "3" "openapi document served"
chk "$(printf '%s' "$SPEC" | j 'str("/v1/operations/orders/{id}/picked-up" in d["paths"]).lower()')" "true" "operations endpoints documented"
chk "$(printf '%s' "$SPEC" | j 'len([1 for p in d["paths"].values() for o in p.values() if "Undocumented" in (o.get("tags") or [])])')" "0" "every served route is documented"
chk "$(curl -s -o /dev/null -w '%{http_code}' $B/docs)" "200" "swagger ui served"

echo "12) SUBSCRIPTION IS OPTIONAL AND SERVICES ARE PUBLISHED"
chk "$(curl -s $B/v1/services | j 'str(any(x["id"]=="dryclean_iron" for x in d["services"])).lower()')" "true" "premium service published"
SLOTG=$(curl -s "$B/v1/slots?date=$DATE" -H "$RH" | j 'd["slots"][0]["id"]')
QUOTE=$(curl -s "$B/v1/pickups/preview?slotId=$SLOTG&estimatedCount=4" -H "$RH")
chk "$(printf '%s' "$QUOTE" | j 'str(isinstance(d["nonSubscriberGarmentRatePaise"], int)).lower()')" "true" "the no plan per garment rate is published"

echo "13) PARTIAL ADD-ONS"
LINES='[{"category":"Shirts","quantity":4,"serviceId":"dryclean_iron"},{"category":"Shirts","quantity":6,"serviceId":"wash_iron"}]'
SLOTL=$(curl -s "$B/v1/slots?date=$DATE" -H "$RH" | j 'd["slots"][0]["id"]')
SPLIT=$(curl -s -X POST $B/v1/pickups -H "$RH" -H 'content-type: application/json' -d "{\"slotId\":\"$SLOTL\",\"lines\":$LINES}")
chk "$(printf '%s' "$SPLIT" | j 'len(d["order"]["lines"])')" "2" "one category split across two services"
chk "$(printf '%s' "$SPLIT" | j 'str(d["order"]["servicesPaise"] > 0).lower()')" "true" "the premium half carries a service charge"
chk "$(curl -s -o /dev/null -w '%{http_code}' -X POST $B/v1/pickups -H "$RH" -H 'content-type: application/json' -d "{\"slotId\":\"$SLOTL\",\"lines\":[{\"category\":\"Shirts\",\"quantity\":1,\"serviceId\":\"gold_plating\"}]}")" "400" "an unknown service is refused"

echo "14) CUSTOMER SUPPORT"
TICKET=$(curl -s -X POST $B/v1/support/tickets -H "$RH" -H 'content-type: application/json' -d '{"category":"delivery_issue","description":"Where is my order?","priority":"emergency"}')
TID=$(printf '%s' "$TICKET" | j 'd["ticket"]["id"]')
chk "$(printf '%s' "$TICKET" | j 'd["ticket"]["status"]')" "open" "resident raised a ticket"
chk "$(curl -s "$B/v1/supervisor/issues?emergency=true" -H "$SH" | j 'str(any(i["id"]=="'"$TID"'" for i in d["issues"])).lower()')" "true" "supervisor sees the emergency"
chk "$(curl -s -X POST $B/v1/supervisor/issues/$TID/reply -H "$SH" -H 'content-type: application/json' -d '{"body":"Out for delivery now."}' | j 'd["issue"]["status"]')" "in_progress" "a reply starts work on the ticket"
chk "$(curl -s -X PATCH $B/v1/supervisor/issues/$TID/status -H "$SH" -H 'content-type: application/json' -d '{"status":"resolved","resolution":"Delivered"}' | j 'd["issue"]["status"]')" "resolved" "supervisor resolved it"
chk "$(curl -s -X POST $B/v1/support/tickets/$TID/close -H "$RH" | j 'd["ticket"]["status"]')" "closed" "resident closed it"
chk "$(curl -s $B/v1/admin/issues/analytics -H "$AH" | j 'str(d["analytics"]["total"] >= 1).lower()')" "true" "admin support analytics reported"

echo "15) STAFF LEAVE DOES NOT STRAND WORK"
chk "$(curl -s -o /dev/null -w '%{http_code}' $B/v1/admin/coverage -H "$AH")" "200" "admin coverage view served"
# A fixed number reserved for the smoke test, well clear of the seeded accounts.
# Creating it again on a repeat run simply conflicts, which is fine: the point is
# that a second operator exists to pick the released work up.
COVER_PHONE="9876590001"
curl -s -o /dev/null -X POST $B/v1/supervisor/operators -H "$SH" -H 'content-type: application/json' -d "{\"fullName\":\"Smoke Cover\",\"phone\":\"$COVER_PHONE\",\"societyIds\":[\"soc-demo\"]}"
chk "$(curl -s $B/v1/supervisor/operators -H "$SH" | j 'str(any(o["phone"]=="'"$COVER_PHONE"'" for o in d["operators"])).lower()')" "true" "a second operator is available to cover"
COTP=$(curl -s -X POST $B/v1/auth/otp/send -H 'content-type: application/json' -d "{\"phone\":\"$COVER_PHONE\"}" | j 'd["otpForTesting"]')
CTOK=$(curl -s -X POST $B/v1/auth/otp/verify -H 'content-type: application/json' -d "{\"phone\":\"$COVER_PHONE\",\"otp\":\"$COTP\"}" | j 'd["token"]')
CH="authorization: Bearer $CTOK"
BEFOREQ=$(curl -s $B/v1/operations/queue -H "$CH" | j 'len(d["orders"])')
chk "$(curl -s -X POST $B/v1/supervisor/operators/user-op/availability -H "$SH" -H 'content-type: application/json' -d '{"status":"on_leave","reason":"Smoke test"}' | j 'd["operator"]["status"]')" "on_leave" "operator marked on leave, not deleted"
chk "$(curl -s -o /dev/null -w '%{http_code}' $B/v1/operations/dashboard -H "$OH")" "401" "an operator on leave no longer holds a session"
AFTERQ=$(curl -s $B/v1/operations/queue -H "$CH" | j 'len(d["orders"])')
chk "$(if [ "$AFTERQ" -gt "$BEFOREQ" ]; then echo yes; else echo no; fi)" "yes" "released work reached the shared queue"
chk "$(curl -s -X POST $B/v1/supervisor/operators/user-op/availability -H "$SH" -H 'content-type: application/json' -d '{"status":"active"}' | j 'd["operator"]["status"]')" "active" "operator returned to duty"

echo ""; echo "==== RESULT: $pass passed, $fail failed ===="
[ "$fail" -eq 0 ]
