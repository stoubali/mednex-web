// ════════════════════════════════════════════════════════════
//  MedNex — Notification Bell (in-app realtime + browser push)
//  Include on doctor-dashboard.html, patient-dashboard.html and
//  admin-dashboard.html, right after the Supabase SDK script tag:
//
//    <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
//    <script src="/notifications.js" defer></script>
//
//  Requires: 01_notifications_schema.sql already run in Supabase,
//  and the push server deployed (update PUSH_SERVER below).
// ════════════════════════════════════════════════════════════
(function () {
  const SUPABASE_URL = "https://xisdwbyermvbqjuqjagn.supabase.co";
  const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhpc2R3Ynllcm12YnFqdXFqYWduIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1MzUyOTksImV4cCI6MjA5ODExMTI5OX0.Ixz6hlLsOUkH04uNivcH81P4-MWeIc_pJZTwnAfm57I";

  // ⚠️ Update this once the push server is deployed
  const PUSH_SERVER = "https://push-service-szey.onrender.com";
  const PDF_SECRET  = "mednex-pdf-secret-2024-xK9#mP2$";

  if (typeof supabase === "undefined") {
    console.error("[notifications] Supabase SDK not loaded before this script.");
    return;
  }
  if (!window.__mednexSupabase) {
    window.__mednexSupabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  }
  const sb = window.__mednexSupabase;

  function esc(v) {
    return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function timeAgo(dateStr) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "à l'instant";
    if (mins < 60) return `il y a ${mins} min`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `il y a ${hrs}h`;
    return `il y a ${Math.floor(hrs / 24)} j`;
  }

  const CSS = `
  .mnx-bell{position:relative;background:transparent;border:none;font-size:1.15rem;color:#3A5A4E;cursor:pointer;padding:6px;transition:color .2s,transform .2s;}
  .mnx-bell:hover{color:#134F33;transform:scale(1.05);}
  .mnx-dot{position:absolute;top:2px;right:2px;background:#EF4444;color:white;border-radius:60px;font-size:0.6rem;padding:1px 5px;font-weight:700;line-height:1.3;display:none;}
  .mnx-panel{position:absolute;top:52px;right:0;width:340px;max-height:440px;overflow-y:auto;background:white;border-radius:20px;box-shadow:0 20px 50px rgba(0,0,0,0.18);border:1px solid #E5ECE8;display:none;z-index:9999;}
  .mnx-panel.open{display:block;}
  .mnx-panel-header{position:sticky;top:0;background:white;padding:14px 18px;font-weight:700;border-bottom:1px solid #E5ECE8;display:flex;justify-content:space-between;align-items:center;font-size:0.9rem;color:#0B1E18;}
  .mnx-panel-header button{background:none;border:none;color:#134F33;font-size:0.72rem;font-weight:600;cursor:pointer;}
  .mnx-panel-header button:hover{text-decoration:underline;}
  .mnx-item{padding:12px 18px;border-bottom:1px solid #F0F4F2;cursor:pointer;display:block;text-decoration:none;color:inherit;transition:background .15s;}
  .mnx-item:hover{background:#F7FAF8;}
  .mnx-item.unread{background:#EAF7EF;}
  .mnx-item h6{font-size:0.85rem;font-weight:700;margin-bottom:2px;color:#0B1E18;}
  .mnx-item p{font-size:0.78rem;color:#5A6F66;line-height:1.4;margin-bottom:3px;}
  .mnx-item time{font-size:0.68rem;color:#8A9E96;}
  .mnx-empty{padding:34px 20px;text-align:center;color:#8A9E96;font-size:0.85rem;}
  .mnx-empty i{font-size:1.7rem;opacity:.4;display:block;margin-bottom:8px;}
  `;
  const styleEl = document.createElement("style");
  styleEl.textContent = CSS;
  document.head.appendChild(styleEl);

  let recipientType = null;
  let recipientId = null;
  let notifs = [];
  let ui = null;

  // ── Work out who's logged in and what kind of profile they have ──
  async function resolveRecipient() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return null;
    const uid = session.user.id;

    const { data: doc } = await sb.from("doctors").select("id").eq("auth_user_id", uid).maybeSingle();
    if (doc) return { type: "doctor", id: doc.id };

    const { data: pat } = await sb.from("patients").select("id").eq("auth_user_id", uid).maybeSingle();
    if (pat) return { type: "patient", id: pat.id };

    const { data: adm } = await sb.from("admin_users").select("id").eq("auth_user_id", uid).maybeSingle();
    if (adm) return { type: "admin", id: adm.id };

    return null;
  }

  // ── Inject the bell button + dropdown into whatever navbar exists ──
  function injectBell() {
    const container = document.querySelector(".topbar-right") || document.querySelector(".navbar-right");
    if (!container) return null;

    let btn = document.getElementById("notifBtn"); // admin-dashboard already has this button
    if (btn) {
      btn.classList.add("mnx-bell");
      const oldDot = btn.querySelector(".notif-dot");
      if (oldDot) oldDot.remove();
    } else {
      btn = document.createElement("button");
      btn.className = "icon-btn mnx-bell";
      btn.type = "button";
      btn.title = "Notifications";
      btn.innerHTML = '<i class="fas fa-bell"></i>';
      container.insertBefore(btn, container.firstChild);
    }
    btn.style.position = "relative";
    if (getComputedStyle(container).position === "static") container.style.position = "relative";

    const badge = document.createElement("span");
    badge.className = "mnx-dot";
    btn.appendChild(badge);

    const panel = document.createElement("div");
    panel.className = "mnx-panel";
    panel.innerHTML = `
      <div class="mnx-panel-header">
        <span>Notifications</span>
        <button type="button" id="mnxMarkAll">Tout marquer lu</button>
      </div>
      <div id="mnxList"></div>`;
    container.appendChild(panel);

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      panel.classList.toggle("open");
    });
    document.addEventListener("click", (e) => {
      if (!panel.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
        panel.classList.remove("open");
      }
    });
    panel.querySelector("#mnxMarkAll").addEventListener("click", markAllRead);

    return { btn, badge, panel, list: panel.querySelector("#mnxList") };
  }

  function renderList() {
    if (!ui) return;
    const unread = notifs.filter((n) => !n.is_read).length;
    ui.badge.style.display = unread ? "inline-block" : "none";
    ui.badge.textContent = unread > 9 ? "9+" : String(unread);

    if (!notifs.length) {
      ui.list.innerHTML = '<div class="mnx-empty"><i class="fas fa-bell-slash"></i>Aucune notification</div>';
      return;
    }

    ui.list.innerHTML = notifs
      .slice(0, 30)
      .map(
        (n) => `
      <a class="mnx-item ${n.is_read ? "" : "unread"}" href="${esc(n.link_url || "#")}" data-id="${esc(n.id)}">
        <h6>${esc(n.title)}</h6>
        <p>${esc(n.message)}</p>
        <time>${esc(timeAgo(n.created_at))}</time>
      </a>`
      )
      .join("");

    ui.list.querySelectorAll(".mnx-item").forEach((a) => {
      a.addEventListener("click", async () => {
        const id = a.dataset.id;
        const n = notifs.find((x) => x.id === id);
        if (n && !n.is_read) {
          n.is_read = true;
          await sb.from("notifications").update({ is_read: true }).eq("id", id);
          renderList();
        }
      });
    });
  }

  async function markAllRead() {
    if (!recipientType) return;
    await sb
      .from("notifications")
      .update({ is_read: true })
      .eq("recipient_type", recipientType)
      .eq("recipient_id", recipientId)
      .eq("is_read", false);
    notifs.forEach((n) => (n.is_read = true));
    renderList();
  }

  async function loadNotifications() {
    const { data, error } = await sb
      .from("notifications")
      .select("*")
      .eq("recipient_type", recipientType)
      .eq("recipient_id", recipientId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) { console.warn("[notifications] load error:", error.message); return; }
    notifs = data || [];
    renderList();
  }

  function subscribeRealtime() {
    sb.channel("notifications-" + recipientId)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `recipient_id=eq.${recipientId}` },
        (payload) => {
          const n = payload.new;
          if (n.recipient_type !== recipientType) return;
          notifs.unshift(n);
          renderList();
          maybeShowForegroundNotification(n);
        }
      )
      .subscribe();
  }

  // While the tab is open but backgrounded, surface a native OS notification too
  function maybeShowForegroundNotification(n) {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    if (!document.hidden) return;
    navigator.serviceWorker?.getRegistration().then((reg) => {
      if (reg) {
        reg.showNotification(n.title, { body: n.message, icon: "/chismya.png", data: { url: n.link_url } });
      } else {
        new Notification(n.title, { body: n.message, icon: "/chismya.png" });
      }
    });
  }

  // ── Browser push (works even when the tab is fully closed) ──────
  function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(base64);
    const arr = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
  }

  async function setupPush() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    try {
      const reg = await navigator.serviceWorker.register("/sw.js");

      let perm = Notification.permission;
      if (perm === "default") perm = await Notification.requestPermission();
      if (perm !== "granted") return;

      const keyRes = await fetch(`${PUSH_SERVER}/vapid-public-key`);
      if (!keyRes.ok) return;
      const { key } = await keyRes.json();

      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(key),
        });
      }

      await fetch(`${PUSH_SERVER}/register-push`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-PDF-Secret": PDF_SECRET },
        body: JSON.stringify({ recipient_type: recipientType, recipient_id: recipientId, subscription: sub.toJSON() }),
      });
    } catch (e) {
      console.warn("[notifications] push setup skipped:", e.message);
    }
  }

  // ── Init ──────────────────────────────────────────────────────
  async function init() {
    const rec = await resolveRecipient();
    if (!rec) return; // not logged in, or no matching profile — nothing to show
    recipientType = rec.type;
    recipientId = rec.id;

    const tryInject = () => {
      ui = injectBell();
      if (!ui) { setTimeout(tryInject, 300); return; }
      loadNotifications();
      subscribeRealtime();
      setupPush();
    };
    tryInject();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
