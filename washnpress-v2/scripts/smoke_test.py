#!/usr/bin/env python3
"""End to end smoke test for the Wash N Press backend.

This script talks to a running instance over HTTP using only the Python standard
library, so it needs no extra packages. It waits for the app to become ready, then
exercises the full flow and prints a pass or fail summary.

Usage:
    BASE_URL=http://localhost:8080 python3 scripts/smoke_test.py

If you want to run this against a remote host over SSH, install paramiko and use
scripts/remote_smoke_test.py, which copies this file to the host and runs it there.
"""
import os
import sys
import json
import time
import hmac
import hashlib
import urllib.request
import urllib.error

BASE = os.environ.get("BASE_URL", "http://localhost:8080")
SECRET = os.environ.get("WEBHOOK_SECRET", "change-me-in-config-local-or-env")

passed = 0
failed = 0


def check(actual, expected, label):
    global passed, failed
    if actual == expected:
        print("  PASS: %s (%s)" % (label, actual))
        passed += 1
    else:
        print("  FAIL: %s (got %r want %r)" % (label, actual, expected))
        failed += 1


def call(path, method="GET", body=None, token=None, raw_body=None):
    url = BASE + path
    if raw_body is not None:
        data = raw_body.encode("utf-8")
    elif body is not None:
        data = json.dumps(body).encode("utf-8")
    else:
        data = None
    headers = {"content-type": "application/json"}
    if token:
        headers["authorization"] = "Bearer " + token
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            text = resp.read().decode("utf-8")
            return resp.status, (json.loads(text) if text else {})
    except urllib.error.HTTPError as e:
        text = e.read().decode("utf-8")
        return e.code, (json.loads(text) if text else {})


def wait_ready():
    print("Waiting for %s to be ready ..." % BASE)
    for i in range(60):
        try:
            status, _ = call("/health")
            if status == 200:
                print("  ready after %ds" % i)
                return True
        except Exception:
            pass
        time.sleep(1)
    return False


def signed(path, event_id, resident_id, amount):
    body = json.dumps({"id": event_id, "event": "payment.captured",
                       "payload": {"residentId": resident_id, "amountPaise": amount}})
    sig = hmac.new(SECRET.encode("utf-8"), body.encode("utf-8"), hashlib.sha256).hexdigest()
    url = BASE + path
    req = urllib.request.Request(url, data=body.encode("utf-8"),
                                 headers={"content-type": "application/json", "x-razorpay-signature": sig},
                                 method="POST")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status
    except urllib.error.HTTPError as e:
        return e.code


def main():
    if not wait_ready():
        print("ERROR: app at %s did not become ready" % BASE)
        sys.exit(1)

    print("0) HEALTH")
    status, data = call("/health")
    check(data.get("status"), "ok", "health live")

    print("1) RESIDENT LOGIN")
    _, sent = call("/v1/auth/otp/send", "POST", {"phone": "9876543210"})
    otp = sent.get("otpForTesting")
    _, verified = call("/v1/auth/otp/verify", "POST", {"phone": "9876543210", "otp": otp})
    token = verified.get("token")
    check(bool(token), True, "resident logged in")

    print("2) FUND WALLET (signed webhook, unique event id)")
    _, before = call("/v1/wallet", token=token)
    b0 = before.get("balancePaise", 0)
    event_id = "evt_py_%d" % int(time.time())
    status = signed("/v1/payments/webhook", event_id, "res-demo", 300000)
    check(status, 200, "signed webhook accepted")
    _, after = call("/v1/wallet", token=token)
    check(after.get("balancePaise", 0) - b0, 300000, "wallet credited by 300000")

    print("3) FORGED WEBHOOK REJECTED")
    req = urllib.request.Request(BASE + "/v1/payments/webhook",
                                 data=b'{"id":"x","payload":{"residentId":"res-demo","amountPaise":1}}',
                                 headers={"content-type": "application/json", "x-razorpay-signature": "deadbeef"},
                                 method="POST")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            code = resp.status
    except urllib.error.HTTPError as e:
        code = e.code
    check(code, 401, "forged webhook rejected")

    print("4) SUBSCRIBE")
    status, _ = call("/v1/subscription/subscribe", "POST", {"planId": "plan-basic", "cycle": "monthly"}, token=token)
    check(status, 201, "subscribed")

    print("5) BOOK PICKUP")
    date = time.strftime("%Y-%m-%d", time.gmtime())
    _, slots = call("/v1/slots?date=" + date, token=token)
    slot_id = slots["slots"][0]["id"]
    _, booked = call("/v1/pickups", "POST", {"slotId": slot_id}, token=token)
    order_id = booked["order"]["id"]
    check(bool(order_id), True, "pickup booked")

    print("6) OPERATOR PIPELINE")
    _, osent = call("/v1/auth/otp/send", "POST", {"phone": "9876500002"})
    _, over = call("/v1/auth/otp/verify", "POST", {"phone": "9876500002", "otp": osent.get("otpForTesting")})
    op = over.get("token")
    call("/v1/operations/orders/%s/picked-up" % order_id, "POST",
         {"items": [{"category": "Shirts", "quantity": 3}, {"category": "Trousers", "quantity": 2}]}, token=op)
    for stage in ("in_wash", "ironing", "qc"):
        call("/v1/operations/orders/%s/advance" % order_id, "POST", {"to": stage}, token=op)
    call("/v1/operations/orders/%s/qc" % order_id, "POST", {"pass": True}, token=op)
    call("/v1/operations/orders/%s/out-for-delivery" % order_id, "POST", token=op)
    _, delivered = call("/v1/operations/orders/%s/deliver" % order_id, "POST", {"deliveryCount": 5}, token=op)
    check(delivered.get("order", {}).get("state"), "delivered", "delivered through full pipeline")

    print("7) GARMENT SPLIT IS CALCULATED BY THE BACKEND")
    _, slots2 = call("/v1/slots?date=" + date, token=token)
    _, booked2 = call("/v1/pickups", "POST", {"slotId": slots2["slots"][0]["id"]}, token=token)
    order2 = booked2["order"]["id"]
    items = [{"category": "Shirts", "quantity": 8}, {"category": "Trousers", "quantity": 5},
             {"category": "Bedsheets", "quantity": 4}, {"category": "Other", "quantity": 3}]
    _, split = call("/v1/operations/orders/%s/garments/preview" % order2, "POST", {"items": items}, token=op)
    summary = split.get("summary", {})
    check(summary.get("acceptedCount"), 20, "accepted quantity totalled from the categories")
    check(summary.get("subscriptionCoveredCount", 0) + summary.get("additionalCount", 0), 20,
          "covered plus additional equals the accepted quantity")
    # The operator supplies only the quantity; the covered split and the charge come back.
    _, picked = call("/v1/operations/orders/%s/picked-up" % order2, "POST", {"items": items}, token=op)
    order_body = picked.get("order", {})
    check(order_body.get("acceptedCount"), 20, "accepted quantity stored against the order")
    check(order_body.get("additionalChargePaise"),
          order_body.get("additionalCount", 0) * order_body.get("additionalRatePaise", 0),
          "additional charge is quantity times rate")

    # Keep booking and collecting until the plan allowance runs out, so the overage
    # path is proven rather than assumed.
    _, usage = call("/v1/subscription/usage", token=token)
    remaining = (usage.get("usage") or {}).get("remaining", 0)
    overage_seen = False
    for _ in range(6):
        if remaining <= 0:
            break
        _, more_slots = call("/v1/slots?date=" + date, token=token)
        if not more_slots.get("slots"):
            break
        _, more = call("/v1/pickups", "POST", {"slotId": more_slots["slots"][0]["id"]}, token=token)
        next_order = more.get("order", {}).get("id")
        if not next_order:
            break
        _, done = call("/v1/operations/orders/%s/picked-up" % next_order, "POST", {"items": items}, token=op)
        body = done.get("order", {})
        remaining = max(0, remaining - body.get("subscriptionCoveredCount", 0))
        if body.get("additionalCount", 0) > 0:
            check(body.get("additionalChargePaise"),
                  body["additionalCount"] * body.get("additionalRatePaise", 0),
                  "overage billed at the configured rate")
            check(body.get("additionalChargeStatus") in ("paid", "pending"), True,
                  "overage carries a payment status")
            overage_seen = True
            break
    check(overage_seen, True, "an over-allowance pickup produced an additional charge")

    print("8) ADMIN PORTAL")
    _, asent = call("/v1/auth/otp/send", "POST", {"phone": "9876500001"})
    _, aver = call("/v1/auth/otp/verify", "POST", {"phone": "9876500001", "otp": asent.get("otpForTesting")})
    admin = aver.get("token")
    status, dash = call("/v1/admin/dashboard", token=admin)
    check(status, 200, "admin dashboard reachable")
    check(dash.get("areas", {}).get("total"), 2, "admin sees every area")
    status, areas = call("/v1/admin/areas", token=admin)
    check(len(areas.get("areas", [])), 2, "area list is system wide")
    status, cfg = call("/v1/admin/config", token=admin)
    check(isinstance(cfg.get("config", {}).get("additionalGarmentRatePaise"), int), True,
          "additional garment rate is configured globally")

    print("9) SUPERVISOR PORTAL AND AREA SCOPE")
    _, ssent = call("/v1/auth/otp/send", "POST", {"phone": "9876500011"})
    _, sver = call("/v1/auth/otp/verify", "POST", {"phone": "9876500011", "otp": ssent.get("otpForTesting")})
    sup = sver.get("token")
    _, sdash = call("/v1/supervisor/dashboard", token=sup)
    check(sdash.get("area", {}).get("name"), "Madhapur", "supervisor dashboard is scoped to their area")
    _, socs = call("/v1/supervisor/societies", token=sup)
    ids = [s["id"] for s in socs.get("societies", [])]
    check("soc-gachibowli" in ids, False, "another area society is not listed")
    status, _ = call("/v1/supervisor/societies/soc-gachibowli", token=sup)
    check(status, 403, "another area society is refused by id")
    status, _ = call("/v1/admin/dashboard", token=sup)
    check(status, 403, "supervisor forbidden from the admin portal")

    print("10) RBAC")
    status, _ = call("/v1/admin/reports/revenue", token=token)
    check(status, 403, "resident forbidden from admin")
    status, _ = call("/v1/supervisor/dashboard", token=token)
    check(status, 403, "resident forbidden from supervisor portal")
    status, _ = call("/v1/operations/dashboard", token=token)
    check(status, 403, "resident forbidden from operations portal")
    status, rdash = call("/v1/resident/dashboard", token=token)
    check(status, 200, "resident dashboard reachable")
    check(rdash.get("subscription") is not None, True, "resident dashboard returns their own plan")

    print("")
    print("==== RESULT: %d passed, %d failed ====" % (passed, failed))
    sys.exit(0 if failed == 0 else 1)


if __name__ == "__main__":
    main()
