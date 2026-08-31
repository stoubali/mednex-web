"""
MedNex — Web Push Notification Server
======================================
Deploy this as its own small service (e.g. a second Render.com Web Service,
same free-tier pattern as your existing `mednex-pdf-server`).

Responsibilities:
  1. Store browser push subscriptions (POST /register-push)
  2. Send Web Push notifications when Supabase triggers call us (POST /send-push)
  3. Hand out the public VAPID key to the frontend (GET /vapid-public-key)

──────────────────────────────────────────────────────────────────
SETUP
──────────────────────────────────────────────────────────────────
1. pip install -r requirements_push.txt

2. Generate a VAPID key pair (one time only):
     python -c "from py_vapid import Vapid02; v=Vapid02(); v.generate_keys(); \
     print('PRIVATE:', v.private_pem().decode()); print('PUBLIC (raw):', v.public_key)"
   Simpler alternative using the `vapid` CLI (installed with py-vapid):
     vapid --gen
   This creates private_key.pem / public_key.pem. Use the pywebpush helper below
   to get the base64 application-server-key your frontend needs:
     python -c "from py_vapid import Vapid02; v=Vapid02.from_file('private_key.pem'); \
     print(v.public_key)"

3. Set environment variables on your host (Render → Environment):
     SUPABASE_URL              = https://xisdwbyermvbqjuqjagn.supabase.co
     SUPABASE_SERVICE_KEY      = <service_role key, NOT the anon key — Settings > API>
     PDF_SECRET                = mednex-pdf-secret-2024-xK9#mP2$   (shared w/ SQL trigger + frontend)
     VAPID_PRIVATE_KEY_PEM     = <contents of private_key.pem>
     VAPID_PUBLIC_KEY          = <base64 public key from step 2>
     VAPID_CLAIMS_SUB          = mailto:mednexteam57@gmail.com

4. Deploy. Note the resulting URL (e.g. https://mednex-push-server.onrender.com)
   and update:
     - 01_notifications_schema.sql  → the url in create_notification()'s net.http_post
     - notifications.js             → PUSH_SERVER constant
──────────────────────────────────────────────────────────────────

──────────────────────────────────────────────────────────────────
Finding C changes (MedNex notification-reliability investigation):
  - Layer 1: the push_subscriptions lookup in send_push() is now
    wrapped in its own try/except. A failure there (e.g. the
    httpx/httpcore read errors observed under rapid successive
    requests) now returns a clean, structured 503 response instead
    of an unhandled 500. No retry logic. No change to webpush
    behavior. No change to /register-push or /unregister-push.
  - Layer 4 (idempotency groundwork only): send_push() now reads an
    optional `notification_id` field from the request body (sent by
    the Supabase side as of this same change) and includes it in log
    lines for correlation. It is not used for deduplication, Topic,
    or tag yet — that is intentionally deferred.
──────────────────────────────────────────────────────────────────
"""

import os
import json
import logging

from flask import Flask, request, jsonify
from flask_cors import CORS
from pywebpush import webpush, WebPushException
from supabase import create_client

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("mednex-push")

app = Flask(__name__)
CORS(app)

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://xisdwbyermvbqjuqjagn.supabase.co")
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_KEY"]  # MUST be service_role key (bypasses RLS)
PDF_SECRET = os.environ.get("PDF_SECRET", "mednex-pdf-secret-2024-xK9#mP2$")

VAPID_PRIVATE_KEY_PEM = os.environ["VAPID_PRIVATE_KEY_PEM"]
VAPID_PUBLIC_KEY = os.environ["VAPID_PUBLIC_KEY"]
VAPID_CLAIMS_SUB = os.environ.get("VAPID_CLAIMS_SUB", "mailto:mednexteam57@gmail.com")

sb = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)


def check_secret():
    return request.headers.get("X-PDF-Secret") == PDF_SECRET


@app.route("/health", methods=["GET"])
def health_check():
    return jsonify({"status": "healthy", "service": "MedNex Push Server"})


@app.route("/vapid-public-key", methods=["GET"])
def vapid_public_key():
    return jsonify({"key": VAPID_PUBLIC_KEY})


@app.route("/register-push", methods=["POST"])
def register_push():
    if not check_secret():
        return jsonify({"error": "unauthorized"}), 401

    data = request.get_json(force=True)
    try:
        recipient_type = data["recipient_type"]
        recipient_id = data["recipient_id"]
        sub = data["subscription"]
        row = {
            "recipient_type": recipient_type,
            "recipient_id": recipient_id,
            "endpoint": sub["endpoint"],
            "p256dh": sub["keys"]["p256dh"],
            "auth": sub["keys"]["auth"],
            "user_agent": request.headers.get("User-Agent", ""),
        }
    except (KeyError, TypeError) as e:
        return jsonify({"error": f"invalid payload: {e}"}), 400

    sb.table("push_subscriptions").upsert(row, on_conflict="endpoint").execute()
    return jsonify({"success": True})


@app.route("/unregister-push", methods=["POST"])
def unregister_push():
    if not check_secret():
        return jsonify({"error": "unauthorized"}), 401
    data = request.get_json(force=True)
    endpoint = data.get("endpoint")
    if not endpoint:
        return jsonify({"error": "endpoint required"}), 400
    sb.table("push_subscriptions").delete().eq("endpoint", endpoint).execute()
    return jsonify({"success": True})


@app.route("/send-push", methods=["POST"])
def send_push():
    # Called by the Supabase SQL trigger (pg_net) whenever a notification is created.
    if not check_secret():
        return jsonify({"error": "unauthorized"}), 401

    data = request.get_json(force=True)
    recipient_type = data.get("recipient_type")
    recipient_id = data.get("recipient_id")
    title = data.get("title", "MedNex")
    message = data.get("message", "")
    link_url = data.get("link_url") or "/"
    # Layer 4 (idempotency groundwork): optional, not yet used for
    # dedup/Topic/tag — only for log correlation with
    # notification_delivery_attempts / net._http_response on the
    # Supabase side.
    notification_id = data.get("notification_id")

    if not recipient_type or not recipient_id:
        return jsonify({"error": "recipient_type and recipient_id required"}), 400

    # Layer 1: narrow try/except around the outbound Supabase lookup
    # only. This is the exact call site identified in Finding C
    # evidence (push_server.py, previously unhandled) where an
    # httpx/httpcore read error under rapid successive requests
    # produced an uncontrolled 500 before any webpush was attempted.
    # No retry is added here — only a controlled, structured failure
    # response so the caller (and our own logs) can distinguish this
    # from a genuine "no subscriptions" or "push failed" case.
    try:
        subs = (
            sb.table("push_subscriptions")
            .select("*")
            .eq("recipient_type", recipient_type)
            .eq("recipient_id", recipient_id)
            .execute()
            .data
        )
    except Exception as e:
        log.error(
            "send_push: subscription lookup failed (notification_id=%s, recipient_type=%s, recipient_id=%s): %s",
            notification_id, recipient_type, recipient_id, e,
        )
        return jsonify({
            "error": "subscription_lookup_failed",
            "notification_id": notification_id,
        }), 503

    payload = json.dumps({"title": title, "body": message, "url": link_url})
    sent, failed = 0, 0

    for s in subs:
        try:
            webpush(
                subscription_info={
                    "endpoint": s["endpoint"],
                    "keys": {"p256dh": s["p256dh"], "auth": s["auth"]},
                },
                data=payload,
                vapid_private_key=VAPID_PRIVATE_KEY_PEM,
                vapid_claims={"sub": VAPID_CLAIMS_SUB},
            )
            sent += 1
        except WebPushException as ex:
            failed += 1
            status = ex.response.status_code if ex.response is not None else None
            log.warning("push failed (%s): %s", status, ex)
            if status in (404, 410):
                # Subscription is dead — clean it up
                sb.table("push_subscriptions").delete().eq("endpoint", s["endpoint"]).execute()

    log.info(
        "send_push: notification_id=%s recipient_type=%s recipient_id=%s sent=%d failed=%d",
        notification_id, recipient_type, recipient_id, sent, failed,
    )

    return jsonify({"success": True, "sent": sent, "failed": failed, "notification_id": notification_id})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5001)))
