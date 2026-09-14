-- ════════════════════════════════════════════════════════════
--  Jureqa — Task #3: notify patient when a medical record
--  ENTERS status = 'completed'.
--
--  Fires on:
--    INSERT where NEW.status = 'completed'
--    UPDATE where OLD.status IS DISTINCT FROM NEW.status
--           AND NEW.status = 'completed'
--
--  Does NOT fire on: draft saves, completed→amended,
--  amended→amended, or any update where status doesn't change.
--
--  Follows the same hardened pattern as trg_appointment_notify /
--  trg_prescription_notify: SECURITY DEFINER, search_path = '',
--  fully qualified references, delegates delivery to the existing
--  public.create_notification().
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.trg_medical_record_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
  v_doctor_name text;
begin
  if TG_OP = 'INSERT' then
    if new.status = 'completed' then
      select full_name into v_doctor_name from public.doctors where id = new.doctor_id;
      perform public.create_notification(
        'patient', new.patient_id, 'Dossier médical complété',
        pg_catalog.format('Votre dossier médical du %s, avec Dr. %s, a été finalisé.',
               new.record_date, coalesce(v_doctor_name, '—')),
        'medical_record_completed', 'patient-dashboard.html',
        pg_catalog.jsonb_build_object('medical_record_id', new.id, 'appointment_id', new.appointment_id)
      );
    end if;
  elsif TG_OP = 'UPDATE' then
    if new.status is distinct from old.status and new.status = 'completed' then
      select full_name into v_doctor_name from public.doctors where id = new.doctor_id;
      perform public.create_notification(
        'patient', new.patient_id, 'Dossier médical complété',
        pg_catalog.format('Votre dossier médical du %s, avec Dr. %s, a été finalisé.',
               new.record_date, coalesce(v_doctor_name, '—')),
        'medical_record_completed', 'patient-dashboard.html',
        pg_catalog.jsonb_build_object('medical_record_id', new.id, 'appointment_id', new.appointment_id)
      );
    end if;
  end if;
  return new;
end;
$function$;

CREATE TRIGGER medical_records_notify
AFTER INSERT OR UPDATE ON public.medical_records
FOR EACH ROW EXECUTE FUNCTION public.trg_medical_record_notify();