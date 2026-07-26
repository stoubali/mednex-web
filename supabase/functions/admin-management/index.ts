// ============================================================
// MedNex — admin-management Edge Function (roadmap item 2.5)
//
// Single entrypoint for every admin_users mutation (invite / remove /
// set_super_admin). Client-side RLS denies direct writes to admin_users
// entirely (see 2.5_admin_management_migration.sql) — this function is
// the *only* path that can create, promote, demote, or remove an admin.
//
// SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY are
// auto-injected into every Supabase Edge Function's environment — no
// manual secret configuration needed for those three.
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://mednex-web.vercel.app",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // ── 1. Identify the caller from their own JWT (respects their session, not privileged) ──
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user: caller }, error: callerErr } = await callerClient.auth.getUser();
  if (callerErr || !caller) return json({ error: "Invalid or expired session" }, 401);

  // ── 2. Privileged client (service_role — bypasses RLS). Only used server-side, never sent to the browser. ──
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // ── 3. Verify the caller is actually a super admin (server-side check, not trusting the client) ──
  const { data: callerRow, error: callerRowErr } = await admin
    .from("admin_users")
    .select("id, is_super_admin")
    .eq("auth_user_id", caller.id)
    .maybeSingle();

  if (callerRowErr) return json({ error: callerRowErr.message }, 500);
  if (!callerRow || !callerRow.is_super_admin) {
    return json({ error: "Only super admins can manage admin accounts" }, 403);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const action = body.action as string;

  async function logAction(action: string, targetId: string | null, details: Record<string, unknown> = {}) {
    await admin.from("admin_audit_log").insert([{
      admin_id: callerRow!.id,
      action,
      target_table: "admin_users",
      target_id: targetId,
      details,
    }]);
  }

  async function countSuperAdmins(): Promise<number> {
    const { count } = await admin
      .from("admin_users")
      .select("id", { count: "exact", head: true })
      .eq("is_super_admin", true);
    return count ?? 0;
  }

  // ── ACTION: invite ────────────────────────────────────────────
  // Creates a brand-new Supabase Auth account (or reuses one if the
  // email already exists) and inserts the corresponding admin_users row.
  if (action === "invite") {
    const email = (body.email as string || "").trim().toLowerCase();
    const fullName = (body.full_name as string || "").trim();
    if (!email || !fullName) return json({ error: "email and full_name are required" }, 400);

    // Already an admin?
    const { data: existingAdmin } = await admin
      .from("admin_users")
      .select("id")
      .eq("email", email)
      .maybeSingle();
    if (existingAdmin) return json({ error: "Cet email est déjà administrateur" }, 409);

    const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: "https://mednex-web.vercel.app/admin-login.html",
    });

    if (inviteErr) return json({ error: `Invitation échouée: ${inviteErr.message}` }, 500);

    const { data: newRow, error: insertErr } = await admin
      .from("admin_users")
      .insert([{ auth_user_id: invited.user.id, full_name: fullName, email, is_super_admin: false }])
      .select("id")
      .single();

    if (insertErr) {
      // Roll back — the Auth user we just invited has no matching
      // admin_users row and would otherwise be orphaned (same failure
      // class the doctor-registration flow had — see register-doctor).
      const { error: rollbackErr } = await admin.auth.admin.deleteUser(invited.user.id);
      if (rollbackErr) {
        console.error("[admin-management] ROLLBACK FAILED for orphaned invited user", invited.user.id, rollbackErr.message);
      }
      return json({ error: insertErr.message }, 500);
    }

    await logAction("invite_admin", newRow.id, { email, full_name: fullName });
    return json({ success: true, id: newRow.id });
  }

  // ── ACTION: remove ────────────────────────────────────────────
  if (action === "remove") {
    const targetId = body.id as string;
    if (!targetId) return json({ error: "id is required" }, 400);
    if (targetId === callerRow.id) return json({ error: "Vous ne pouvez pas vous supprimer vous-même" }, 400);

    const { data: target } = await admin.from("admin_users").select("id, is_super_admin, email").eq("id", targetId).maybeSingle();
    if (!target) return json({ error: "Admin introuvable" }, 404);

    if (target.is_super_admin) {
      const remaining = await countSuperAdmins();
      if (remaining <= 1) return json({ error: "Impossible de supprimer le dernier super admin" }, 400);
    }

    const { error: delErr } = await admin.from("admin_users").delete().eq("id", targetId);
    if (delErr) return json({ error: delErr.message }, 500);

    await logAction("remove_admin", targetId, { email: target.email });
    return json({ success: true });
  }

  // ── ACTION: set_super_admin ───────────────────────────────────
  if (action === "set_super_admin") {
    const targetId = body.id as string;
    const value = body.value as boolean;
    if (!targetId || typeof value !== "boolean") return json({ error: "id and value are required" }, 400);
    if (targetId === callerRow.id) return json({ error: "Vous ne pouvez pas modifier votre propre statut" }, 400);

    const { data: target } = await admin.from("admin_users").select("is_super_admin").eq("id", targetId).maybeSingle();
    if (!target) return json({ error: "Admin introuvable" }, 404);

    if (value === false && target.is_super_admin) {
      const remaining = await countSuperAdmins();
      if (remaining <= 1) return json({ error: "Impossible de rétrograder le dernier super admin" }, 400);
    }

    const { error: updErr } = await admin.from("admin_users").update({ is_super_admin: value }).eq("id", targetId);
    if (updErr) return json({ error: updErr.message }, 500);

    await logAction(value ? "promote_super_admin" : "demote_super_admin", targetId, {});
    return json({ success: true });
  }

  return json({ error: `Unknown action: ${action}` }, 400);
});
