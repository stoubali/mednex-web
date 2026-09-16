-- ════════════════════════════════════════════════════════════
--  Jureqa — Task #4: schedule automatic confirmed → completed
--
--  Separate job from expire-stale-pending-appointments (unchanged).
--  Schedule: every 15 minutes — matches the existing pending-expiry
--  job's cadence and the app's own 15-minute appointment-slot
--  granularity, so a completed appointment is picked up within at
--  most ~15 minutes of crossing the 30-minute grace threshold. No
--  more frequent than necessary at current appointment volume.
-- ════════════════════════════════════════════════════════════

SELECT cron.schedule(
  'complete-past-confirmed-appointments',
  '*/15 * * * *',
  $$SELECT public.complete_past_confirmed_appointments();$$
);
;