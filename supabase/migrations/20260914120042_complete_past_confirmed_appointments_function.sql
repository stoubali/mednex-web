-- ════════════════════════════════════════════════════════════
--  Jureqa — Task #4: automatic confirmed → completed lifecycle
--
--  Separate from expire_stale_pending_appointments() by design
--  (per Task #4 approval — different eligible-status set, different
--  semantics, kept independently auditable/rollback-able).
--
--  `completed` means only that the scheduled appointment window has
--  ended without cancellation. It does NOT assert that the patient
--  attended or that the doctor performed the visit. No-show is
--  explicitly out of scope (Task #4 product decision).
--
--  Eligible transition ONLY: confirmed → completed.
--  pending, cancelled, and already-completed rows are structurally
--  excluded by the WHERE clause below — never touched.
--
--  No notification is sent (Task #4 product decision). This is safe
--  without touching trg_appointment_notify(): that trigger's UPDATE
--  branch only matches new.status = 'confirmed' or 'cancelled' — it
--  has no 'completed' case, so this UPDATE is silent by construction.
--  trg_appointment_notify() is NOT modified by this migration.
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.complete_past_confirmed_appointments()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_count integer := 0;
BEGIN
  -- Single set-based UPDATE. Only `status` is modified; every other
  -- column on affected rows is preserved untouched.
  --
  -- Completion rule: appointment end time (date + end_time), explicitly
  -- interpreted in Africa/Casablanca local time (never relying on the
  -- database's own UTC default), plus a 30-minute grace period, has
  -- passed relative to the current instant. Matches the existing
  -- expire_stale_pending_appointments() timezone-handling pattern.
  UPDATE public.appointments
  SET status = 'completed'
  WHERE status = 'confirmed'
    AND (date::timestamp + end_time) AT TIME ZONE 'Africa/Casablanca'
          + interval '30 minutes' < pg_catalog.now();

  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- One summary audit row per run, only when at least one appointment
  -- was actually completed (avoids empty-run log noise), mirroring the
  -- existing expire_stale_pending_appointments() pattern exactly.
  -- admin_id = NULL is legal (nullable column, FK does not reject NULL)
  -- — no fake admin identity is created; no RLS policy is referenced
  -- or modified, matching the established production pattern.
  IF v_count > 0 THEN
    INSERT INTO public.admin_audit_log (admin_id, action, target_table, target_id, details)
    VALUES (
      NULL,
      'auto_complete_past_confirmed',
      'appointments',
      NULL,
      pg_catalog.jsonb_build_object('count', v_count, 'run_at', pg_catalog.now())
    );
  END IF;

  RETURN v_count;
END;
$function$;

-- Internal-only: intended to be invoked solely by pg_cron (which runs
-- as postgres). New functions created by postgres in this project
-- inherit default privileges that grant EXECUTE to PUBLIC/anon/
-- authenticated (verified via pg_default_acl before writing this
-- migration) — explicitly revoke those, matching the exact grant
-- shape already in place for expire_stale_pending_appointments() and
-- create_notification() (verified via information_schema.routine_privileges:
-- both currently grant EXECUTE to postgres + service_role only).
REVOKE EXECUTE ON FUNCTION public.complete_past_confirmed_appointments() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.complete_past_confirmed_appointments() FROM anon;
REVOKE EXECUTE ON FUNCTION public.complete_past_confirmed_appointments() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.complete_past_confirmed_appointments() TO postgres;
GRANT EXECUTE ON FUNCTION public.complete_past_confirmed_appointments() TO service_role;
;