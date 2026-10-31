
-- Allow the doctor demo to target whichever fictional doctor the visitor selected.
drop function if exists public.start_demo_session(text);

create function public.start_demo_session(
  p_role text,
  p_doctor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_session public.demo_sessions%rowtype;
  v_doctor uuid;
  v_patient_id uuid;
  v_sample_patient_1 uuid;
  v_sample_patient_2 uuid;
  v_slot_1 uuid;
  v_slot_2 uuid;
begin
  if v_uid is null or coalesce((auth.jwt()->>'is_anonymous')::boolean, false) is not true then
    raise exception 'A Supabase anonymous session is required';
  end if;
  if p_role not in ('doctor','patient') then
    raise exception 'Invalid demo role';
  end if;
  if p_role = 'patient' and p_doctor_id is not null then
    raise exception 'A patient demo cannot select a doctor dashboard';
  end if;

  if p_role = 'doctor' then
    v_doctor := coalesce(p_doctor_id, 'd0000000-0000-4000-8000-000000000001'::uuid);
    if not exists (select 1 from public.demo_doctors where id = v_doctor and is_demo = true) then
      raise exception 'Invalid demo doctor';
    end if;
  end if;

  select * into v_session
  from public.demo_sessions
  where owner_id = v_uid
  for update;

  if found and v_session.expires_at > now()
     and v_session.role = p_role
     and v_session.demo_doctor_id is not distinct from v_doctor then
    update public.demo_sessions set last_seen_at = now() where owner_id = v_uid;
    return jsonb_build_object(
      'session_id', v_session.id,
      'role', v_session.role,
      'demo_doctor_id', v_session.demo_doctor_id,
      'expires_at', v_session.expires_at,
      'reused', true
    );
  end if;

  if found and v_session.expires_at <= now() then
    delete from public.demo_appointments where owner_id = v_uid;
    delete from public.demo_patients where owner_id = v_uid;
    delete from public.demo_sessions where owner_id = v_uid;
    v_session := null;
  end if;

  if v_session.id is null then
    insert into public.demo_sessions(owner_id, role, demo_doctor_id)
    values (v_uid, p_role, v_doctor)
    returning * into v_session;
  else
    -- Preserve this visitor's isolated workspace while changing role/doctor.
    update public.demo_sessions
      set role = p_role,
          demo_doctor_id = v_doctor,
          last_seen_at = now()
      where owner_id = v_uid
      returning * into v_session;
  end if;

  if p_role = 'patient' then
    select id into v_patient_id
    from public.demo_patients
    where owner_id = v_uid and full_name = 'Samira Demo'
    order by created_at limit 1;

    if v_patient_id is null then
      insert into public.demo_patients(owner_id, full_name, age, gender, reason_for_visit)
      values (v_uid, 'Samira Demo', 31, 'female', 'General consultation')
      returning id into v_patient_id;
    end if;
  else
    if not exists (
      select 1 from public.demo_appointments
      where owner_id = v_uid
        and doctor_id = v_doctor
        and notes in ('Fictional sample appointment', 'Fictional follow-up appointment')
    ) then
      insert into public.demo_patients(owner_id, full_name, age, gender, reason_for_visit)
      values (v_uid, 'Adam Demo', 34, 'male', 'Routine consultation')
      returning id into v_sample_patient_1;

      insert into public.demo_patients(owner_id, full_name, age, gender, reason_for_visit)
      values (v_uid, 'Meryem Sample', 28, 'female', 'Follow-up appointment')
      returning id into v_sample_patient_2;

      select id into v_slot_1 from public.demo_slots
      where doctor_id = v_doctor and starts_at > now() + interval '1 day'
      order by starts_at limit 1;

      select id into v_slot_2 from public.demo_slots
      where doctor_id = v_doctor and starts_at > now() + interval '1 day'
      order by starts_at offset 1 limit 1;

      if v_slot_1 is not null and not exists (
        select 1 from public.demo_appointments
        where owner_id = v_uid and slot_id = v_slot_1 and status <> 'cancelled'
      ) then
        insert into public.demo_appointments(owner_id, patient_id, doctor_id, slot_id, status, notes)
        values (v_uid, v_sample_patient_1, v_doctor, v_slot_1, 'confirmed', 'Fictional sample appointment');
      end if;

      if v_slot_2 is not null and not exists (
        select 1 from public.demo_appointments
        where owner_id = v_uid and slot_id = v_slot_2 and status <> 'cancelled'
      ) then
        insert into public.demo_appointments(owner_id, patient_id, doctor_id, slot_id, status, notes)
        values (v_uid, v_sample_patient_2, v_doctor, v_slot_2, 'pending', 'Fictional follow-up appointment');
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'session_id', v_session.id,
    'role', v_session.role,
    'demo_doctor_id', v_session.demo_doctor_id,
    'expires_at', v_session.expires_at,
    'reused', false
  );
end;
$function$;

-- Rebind reset to the new signature and keep its cleanup semantics.
create or replace function public.reset_demo_session()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_doctor uuid;
begin
  if v_uid is null or coalesce((auth.jwt()->>'is_anonymous')::boolean, false) is not true then
    raise exception 'A demo guest session is required';
  end if;

  select role, demo_doctor_id into v_role, v_doctor
  from public.demo_sessions
  where owner_id = v_uid and expires_at > now()
  for update;

  if v_role is null then
    raise exception 'No active demo session';
  end if;

  delete from public.demo_appointments where owner_id = v_uid;
  delete from public.demo_patients where owner_id = v_uid;
  delete from public.demo_sessions where owner_id = v_uid;

  return public.start_demo_session(v_role, v_doctor);
end;
$function$;

drop policy if exists "demo guests can update own demo appointments" on public.demo_appointments;
drop policy if exists "demo patient owner can update own sample patients" on public.demo_patients;

revoke all on function public.start_demo_session(text, uuid) from public, anon;
revoke all on function public.book_demo_appointment(uuid, uuid, text) from public, anon;
revoke all on function public.set_demo_appointment_status(uuid, text) from public, anon;
revoke all on function public.reset_demo_session() from public, anon;
grant execute on function public.start_demo_session(text, uuid) to authenticated;
grant execute on function public.book_demo_appointment(uuid, uuid, text) to authenticated;
grant execute on function public.set_demo_appointment_status(uuid, text) to authenticated;
grant execute on function public.reset_demo_session() to authenticated;
