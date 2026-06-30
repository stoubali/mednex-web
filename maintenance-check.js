// ════════════════════════════════════════════════════════════
//  MedNex — Maintenance Mode Guard
//  Include this script on every public page (login, register,
//  dashboards) right after the Supabase SDK script tag.
//  It redirects to maintenance.html if maintenance_mode is ON.
// ════════════════════════════════════════════════════════════
(function () {
  const SUPABASE_URL = "https://xisdwbyermvbqjuqjagn.supabase.co";
  const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhpc2R3Ynllcm12YnFqdXFqYWduIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1MzUyOTksImV4cCI6MjA5ODExMTI5OX0.Ixz6hlLsOUkH04uNivcH81P4-MWeIc_pJZTwnAfm57I";

  if (typeof supabase === "undefined") {
    console.error("[maintenance-check] Supabase SDK not loaded before this script.");
    return;
  }

  // Reuse ONE shared client across the whole page (this script + the page's
  // own inline script). Creating multiple GoTrueClient instances against the
  // same storage key corrupts/loses the session on refresh.
  if (!window.__mednexSupabase) {
    window.__mednexSupabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  }
  const _sb = window.__mednexSupabase;

  // Never block the admin pages themselves
  const path = window.location.pathname.toLowerCase();
  if (path.includes("admin-login") || path.includes("admin-dashboard") || path.includes("maintenance.html")) {
    return;
  }

  _sb.from("app_settings")
    .select("value")
    .eq("key", "maintenance_mode")
    .single()
    .then(({ data, error }) => {
      if (error) {
        console.warn("[maintenance-check] could not read app_settings:", error.message);
        return;
      }
      if (data && data.value === "true") {
        window.location.replace("maintenance.html");
      }
    })
    .catch(err => console.warn("[maintenance-check] exception:", err));
})();
