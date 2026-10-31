-- Support foreign-key lookups and cleanup without changing demo behavior.
create index if not exists demo_appointments_doctor_id_idx
  on public.demo_appointments (doctor_id);
create index if not exists demo_appointments_patient_owner_idx
  on public.demo_appointments (patient_id, owner_id);
create index if not exists demo_appointments_slot_id_idx
  on public.demo_appointments (slot_id);
create index if not exists demo_patients_owner_id_idx
  on public.demo_patients (owner_id);
create index if not exists demo_sessions_demo_doctor_id_idx
  on public.demo_sessions (demo_doctor_id);

-- Reject NULL inputs explicitly so invalid RPC payloads fail with controlled messages.
create or replace function public.start_demo_session(p_role text, p_doctor_id uuid default null::uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
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
  if p_role is null or p_role not in ('doctor','patient') then
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
    update public.demo_sessions
      set role = p_role, demo_doctor_id = v_doctor, last_seen_at = now()
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
      select 1 from public.demo_patients
      where owner_id = v_uid and full_name in ('Adam Demo', 'Meryem Sample')
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

create or replace function public.book_demo_appointment(p_doctor_id uuid, p_slot_id uuid, p_notes text default ''::text)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_session public.demo_sessions%rowtype;
  v_patient_id uuid;
  v_appointment_id uuid;
begin
  if v_uid is null or coalesce((auth.jwt()->>'is_anonymous')::boolean, false) is not true then
    raise exception 'A demo guest session is required';
  end if;
  if p_doctor_id is null or p_slot_id is null then
    raise exception 'A doctor and appointment slot are required';
  end if;

  select * into v_session
  from public.demo_sessions
  where owner_id = v_uid and expires_at > now()
  for update;

  if not found or v_session.role <> 'patient' then
    raise exception 'An active patient demo session is required';
  end if;

  select id into v_patient_id
  from public.demo_patients
  where owner_id = v_uid and full_name = 'Samira Demo'
  order by created_at limit 1;

  if v_patient_id is null then
    raise exception 'Demo patient profile not found';
  end if;

  if not exists (
    select 1 from public.demo_doctors d
    join public.demo_slots s on s.doctor_id = d.id
    where d.id = p_doctor_id and d.is_demo = true
      and s.id = p_slot_id and s.starts_at > now()
  ) then
    raise exception 'Invalid or expired demo slot';
  end if;

  insert into public.demo_appointments(owner_id, patient_id, doctor_id, slot_id, notes)
  values (v_uid, v_patient_id, p_doctor_id, p_slot_id, left(coalesce(p_notes,''), 300))
  returning id into v_appointment_id;

  return v_appointment_id;
exception
  when unique_violation then
    raise exception 'This slot is already booked in your demo. Please choose another time.';
end;
$function$;

create or replace function public.set_demo_appointment_status(p_appointment_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_session public.demo_sessions%rowtype;
  v_current_status text;
  v_appointment_owner uuid;
  v_appointment_doctor uuid;
  v_appointment_patient uuid;
begin
  if v_uid is null or coalesce((auth.jwt()->>'is_anonymous')::boolean, false) is not true then
    raise exception 'A demo guest session is required';
  end if;
  if p_appointment_id is null or p_status is null or p_status not in ('confirmed','cancelled','completed') then
    raise exception 'Invalid demo appointment status request';
  end if;

  select * into v_session
  from public.demo_sessions
  where owner_id = v_uid and expires_at > now()
  for update;

  if not found then
    raise exception 'Demo session expired';
  end if;

  select status, owner_id, doctor_id, patient_id
  into v_current_status, v_appointment_owner, v_appointment_doctor, v_appointment_patient
  from public.demo_appointments
  where id = p_appointment_id and owner_id = v_uid
  for update;

  if not found or v_appointment_owner <> v_uid then
    raise exception 'Demo appointment not found or action not allowed';
  end if;

  if v_session.role = 'doctor' then
    if v_appointment_doctor <> v_session.demo_doctor_id then
      raise exception 'This appointment belongs to a different demo doctor';
    end if;
    if not (
      (v_current_status = 'pending' and p_status in ('confirmed','cancelled')) or
      (v_current_status = 'confirmed' and p_status in ('completed','cancelled'))
    ) then
      raise exception 'Invalid status transition';
    end if;
  elsif v_session.role = 'patient' then
    if p_status <> 'cancelled'
      or not exists (
        select 1 from public.demo_patients
        where id = v_appointment_patient and owner_id = v_uid and full_name = 'Samira Demo'
      )
      or v_current_status not in ('pending','confirmed') then
      raise exception 'This patient action is not allowed';
    end if;
  else
    raise exception 'This action is not allowed for the current demo role';
  end if;

  update public.demo_appointments
  set status = p_status
  where id = p_appointment_id and owner_id = v_uid;
end;
$function$;

-- Preserve the intended narrow RPC exposure.
revoke all on function public.start_demo_session(text, uuid) from public, anon;
revoke all on function public.book_demo_appointment(uuid, uuid, text) from public, anon;
revoke all on function public.set_demo_appointment_status(uuid, text) from public, anon;
revoke all on function public.reset_demo_session() from public, anon;
grant execute on function public.start_demo_session(text, uuid) to authenticated;
grant execute on function public.book_demo_appointment(uuid, uuid, text) to authenticated;
grant execute on function public.set_demo_appointment_status(uuid, text) to authenticated;
grant execute on function public.reset_demo_session() to authenticated;