-- ════════════════════════════════════════════════════════════
--  Jureqa — Task #4 follow-up (blocker found during verification)
--
--  protect_appointment_sensitive_columns() (BEFORE UPDATE trigger on
--  public.appointments) rejects any non-admin status write that isn't
--  'confirmed' or 'cancelled' — including from SECURITY DEFINER
--  functions, because it keys off auth.uid(), which is NULL when
--  pg_cron invokes a function (no JWT), so v_is_admin is false.
--  complete_past_confirmed_appointments() writing 'completed' was
--  unconditionally rejected.
--
--  Fix: reuse the EXACT existing trusted-internal-write pattern
--  already in production for expire_stale_pending_appointments() /
--  trg_appointment_notify() (mednex.is_auto_expiry) — a
--  transaction-local session flag, set only inside our own function,
--  checked narrowly by the trigger for the 'completed' case only.
--
--  Scope of the bypass is intentionally narrow:
--    - Only unblocks NEW.status = 'completed'.
--    - Only when mednex.is_auto_complete = 'true' for that
--      transaction — which only complete_past_confirmed_appointments()
--      ever sets, and only transaction-locally (3rd arg = true, so it
--      can never leak into or affect any other session/transaction).
--    - Every other caller (patient/doctor/admin UI, any direct API
--      call) never sets this flag, so current_setting(..., true)
--      returns NULL there and behavior for them is byte-for-byte
--      unchanged from before this migration.
--    - patient_id/doctor_id/date/start_time/end_time protection is
--      untouched — completion only ever writes `status`.
--    - Admin bypass (v_is_admin) is untouched.
--
--  No RLS is modified. No grants are modified. No other function is
--  modified.
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.protect_appointment_sensitive_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_is_admin boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.admin_users
    WHERE auth_user_id = auth.uid()
  )
  INTO v_is_admin;

  IF NOT v_is_admin THEN

    IF NEW.patient_id IS DISTINCT FROM OLD.patient_id
       OR NEW.doctor_id IS DISTINCT FROM OLD.doctor_id
       OR NEW.date IS DISTINCT FROM OLD.date
       OR NEW.start_time IS DISTINCT FROM OLD.start_time
       OR NEW.end_time IS DISTINCT FROM OLD.end_time
    THEN
      RAISE EXCEPTION
        'Vous ne pouvez pas modifier ce champ. Contactez un administrateur.';
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status
       AND NOT (
         NEW.status = ANY (
           ARRAY['confirmed', 'cancelled']
         )
         OR (
           -- Task #4: allow the one trusted internal path that writes
           -- 'completed' — complete_past_confirmed_appointments(),
           -- identified solely by this transaction-local flag.
           NEW.status = 'completed'
           AND pg_catalog.current_setting('mednex.is_auto_complete', true) = 'true'
         )
       )
    THEN
      RAISE EXCEPTION
        'Statut de rendez-vous invalide.';
    END IF;

  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.complete_past_confirmed_appointments()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_count integer := 0;
BEGIN
  -- Transaction-local flag (identical mechanism to expire_stale_
  -- pending_appointments()'s mednex.is_auto_expiry), read by
  -- protect_appointment_sensitive_columns() to allow this specific,
  -- trusted internal transition into 'completed'. Scoped to this
  -- transaction only (3rd arg = true) — cannot leak into or affect
  -- any concurrent manual write from patient/doctor/admin UIs.
  PERFORM pg_catalog.set_config('mednex.is_auto_complete', 'true', true);

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

REVOKE EXECUTE ON FUNCTION public.complete_past_confirmed_appointments() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.complete_past_confirmed_appointments() FROM anon;
REVOKE EXECUTE ON FUNCTION public.complete_past_confirmed_appointments() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.complete_past_confirmed_appointments() TO postgres;
GRANT EXECUTE ON FUNCTION public.complete_past_confirmed_appointments() TO service_role;
;