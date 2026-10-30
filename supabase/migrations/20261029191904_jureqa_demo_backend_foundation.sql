
-- Jureqa public demo backend foundation. Beta project only.
-- All writable records are owned by one anonymous auth user (owner_id).
-- No production tables, users, secrets, or records are referenced.

create table public.demo_doctors (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  specialty text not null,
  city text not null default 'Casablanca',
  clinic_address text not null,
  description text not null default '',
  avg_rating numeric(2,1) not null default 4.8 check (avg_rating between 0 and 5),
  review_count integer not null default 0 check (review_count >= 0),
  is_demo boolean not null default true check (is_demo = true)
);

create table public.demo_slots (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null references public.demo_doctors(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  is_demo boolean not null default true check (is_demo = true),
  check (ends_at > starts_at),
  unique (doctor_id, starts_at)
);

create table public.demo_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users(id) on delete cascade,
  role text not null check (role in ('doctor','patient')),
  demo_doctor_id uuid references public.demo_doctors(id),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  check ((role = 'doctor' and demo_doctor_id is not null) or (role = 'patient' and demo_doctor_id is null))
);

create table public.demo_patients (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  full_name text not null,
  age integer not null check (age between 1 and 120),
  gender text not null check (gender in ('female','male','other')),
  reason_for_visit text not null default 'General consultation',
  created_at timestamptz not null default now(),
  is_demo boolean not null default true check (is_demo = true),
  unique (id, owner_id)
);

create table public.demo_appointments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  patient_id uuid not null,
  doctor_id uuid not null references public.demo_doctors(id),
  slot_id uuid not null references public.demo_slots(id),
  status text not null default 'pending' check (status in ('pending','confirmed','completed','cancelled')),
  notes text not null default '',
  created_at timestamptz not null default now(),
  is_demo boolean not null default true check (is_demo = true),
  constraint demo_appointments_patient_owner_fk
    foreign key (patient_id, owner_id) references public.demo_patients(id, owner_id) on delete cascade
);

create unique index demo_appointments_one_active_booking_per_slot
  on public.demo_appointments(slot_id) where status <> 'cancelled';
create index demo_appointments_owner_created_idx
  on public.demo_appointments(owner_id, created_at desc);
create index demo_slots_doctor_starts_idx on public.demo_slots(doctor_id, starts_at);

alter table public.demo_doctors enable row level security;
alter table public.demo_slots enable row level security;
alter table public.demo_sessions enable row level security;
alter table public.demo_patients enable row level security;
alter table public.demo_appointments enable row level security;

create policy "demo doctors readable by demo guests"
  on public.demo_doctors for select to authenticated
  using ((select coalesce((auth.jwt()->>'is_anonymous')::boolean, false)));

create policy "demo slots readable by demo guests"
  on public.demo_slots for select to authenticated
  using ((select coalesce((auth.jwt()->>'is_anonymous')::boolean, false)));

create policy "demo session owner can read active session"
  on public.demo_sessions for select to authenticated
  using (owner_id = (select auth.uid())
    and (select coalesce((auth.jwt()->>'is_anonymous')::boolean, false))
    and expires_at > now());

create policy "demo patient owner can read own sample patients"
  on public.demo_patients for select to authenticated
  using (owner_id = (select auth.uid())
    and (select coalesce((auth.jwt()->>'is_anonymous')::boolean, false))
    and exists (select 1 from public.demo_sessions s
      where s.owner_id = (select auth.uid()) and s.expires_at > now()));

create policy "demo patient owner can update own sample patients"
  on public.demo_patients for update to authenticated
  using (owner_id = (select auth.uid())
    and (select coalesce((auth.jwt()->>'is_anonymous')::boolean, false))
    and exists (select 1 from public.demo_sessions s
      where s.owner_id = (select auth.uid()) and s.expires_at > now()))
  with check (owner_id = (select auth.uid()));

create policy "demo guests can read own demo appointments"
  on public.demo_appointments for select to authenticated
  using (owner_id = (select auth.uid())
    and (select coalesce((auth.jwt()->>'is_anonymous')::boolean, false))
    and exists (select 1 from public.demo_sessions s
      where s.owner_id = (select auth.uid()) and s.expires_at > now()));

create policy "demo guests can update own demo appointments"
  on public.demo_appointments for update to authenticated
  using (owner_id = (select auth.uid())
    and (select coalesce((auth.jwt()->>'is_anonymous')::boolean, false))
    and exists (select 1 from public.demo_sessions s
      where s.owner_id = (select auth.uid()) and s.expires_at > now()))
  with check (owner_id = (select auth.uid()));

grant usage on schema public to authenticated;
grant select on public.demo_doctors, public.demo_slots, public.demo_sessions,
  public.demo_patients, public.demo_appointments to authenticated;
grant update on public.demo_patients, public.demo_appointments to authenticated;

-- Seed only fictional, clearly-labelled demo clinicians and future time slots.
insert into public.demo_doctors (id, full_name, specialty, city, clinic_address, description, avg_rating, review_count)
values
 ('d0000000-0000-4000-8000-000000000001','Dr. Lina Amrani','General Medicine','Casablanca','Demo Clinic, Maarif','Fictional doctor for testing the Jureqa patient experience.',4.9,18),
 ('d0000000-0000-4000-8000-000000000002','Dr. Youssef Bennani','Cardiology','Casablanca','Demo Clinic, Gauthier','Fictional doctor for testing search and appointment booking.',4.8,12),
 ('d0000000-0000-4000-8000-000000000003','Dr. Salma Idrissi','Dermatology','Rabat','Demo Clinic, Agdal','Fictional doctor for testing specialties and availability.',4.7,9);

insert into public.demo_slots (doctor_id, starts_at, ends_at)
select d.id,
       (date_trunc('day', now() + (day_offset || ' days')::interval)
          + time_slot::time) at time zone 'Africa/Casablanca',
       ((date_trunc('day', now() + (day_offset || ' days')::interval)
          + time_slot::time) + interval '30 minutes') at time zone 'Africa/Casablanca'
from public.demo_doctors d
cross join generate_series(1, 7) as day_offset
cross join (values ('09:00'),('09:30'),('10:00'),('10:30'),('14:00'),('14:30'),('15:00'),('15:30')) as t(time_slot)
where extract(isodow from (now() + (day_offset || ' days')::interval)) between 1 and 6;

-- Authenticated anonymous users are required; normal signed-in accounts are rejected.
create or replace function public.start_demo_session(p_role text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_session public.demo_sessions%rowtype;
  v_doctor uuid;
  v_patient_1 uuid;
  v_patient_2 uuid;
  v_slot_1 uuid;
  v_slot_2 uuid;
begin
  if v_uid is null
     or coalesce((auth.jwt()->>'is_anonymous')::boolean, false) is not true then
    raise exception 'A Supabase anonymous session is required';
  end if;
  if p_role not in ('doctor','patient') then
    raise exception 'Invalid demo role';
  end if;

  select * into v_session from public.demo_sessions where owner_id = v_uid for update;

  if found and v_session.expires_at > now() and v_session.role = p_role then
    update public.demo_sessions set last_seen_at = now() where owner_id = v_uid;
    return jsonb_build_object('session_id', v_session.id, 'role', v_session.role,
      'expires_at', v_session.expires_at, 'reused', true);
  end if;

  delete from public.demo_sessions where owner_id = v_uid;

  if p_role = 'doctor' then
    v_doctor := 'd0000000-0000-4000-8000-000000000001'::uuid;
  end if;

  insert into public.demo_sessions(owner_id, role, demo_doctor_id)
  values (v_uid, p_role, v_doctor)
  returning * into v_session;

  if p_role = 'doctor' then
    insert into public.demo_patients(owner_id, full_name, age, gender, reason_for_visit)
    values (v_uid, 'Adam Demo', 34, 'male', 'Routine consultation')
    returning id into v_patient_1;

    insert into public.demo_patients(owner_id, full_name, age, gender, reason_for_visit)
    values (v_uid, 'Meryem Sample', 28, 'female', 'Follow-up appointment')
    returning id into v_patient_2;

    select id into v_slot_1 from public.demo_slots
      where doctor_id = v_doctor and starts_at > now() + interval '1 day'
      order by starts_at limit 1;
    select id into v_slot_2 from public.demo_slots
      where doctor_id = v_doctor and starts_at > now() + interval '1 day'
      order by starts_at offset 1 limit 1;

    if v_slot_1 is not null then
      insert into public.demo_appointments(owner_id, patient_id, doctor_id, slot_id, status, notes)
      values (v_uid, v_patient_1, v_doctor, v_slot_1, 'confirmed', 'Fictional sample appointment');
    end if;
    if v_slot_2 is not null then
      insert into public.demo_appointments(owner_id, patient_id, doctor_id, slot_id, status, notes)
      values (v_uid, v_patient_2, v_doctor, v_slot_2, 'pending', 'Fictional follow-up appointment');
    end if;
  else
    insert into public.demo_patients(owner_id, full_name, age, gender, reason_for_visit)
    values (v_uid, 'Samira Demo', 31, 'female', 'General consultation')
    returning id into v_patient_1;
  end if;

  return jsonb_build_object('session_id', v_session.id, 'role', v_session.role,
    'expires_at', v_session.expires_at, 'reused', false);
end;
$function$;

create or replace function public.book_demo_appointment(p_doctor_id uuid, p_slot_id uuid, p_notes text default '')
returns uuid
language plpgsql
security definer
set search_path = ''
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
  select * into v_session from public.demo_sessions
    where owner_id = v_uid and expires_at > now() for update;
  if not found or v_session.role <> 'patient' then
    raise exception 'An active patient demo session is required';
  end if;

  select id into v_patient_id from public.demo_patients where owner_id = v_uid order by created_at limit 1;
  if v_patient_id is null then raise exception 'Demo patient profile not found'; end if;
  if not exists (select 1 from public.demo_slots
    where id = p_slot_id and doctor_id = p_doctor_id and starts_at > now()) then
    raise exception 'Invalid or expired demo slot';
  end if;

  insert into public.demo_appointments(owner_id, patient_id, doctor_id, slot_id, notes)
  values (v_uid, v_patient_id, p_doctor_id, p_slot_id, left(coalesce(p_notes,''), 300))
  returning id into v_appointment_id;
  return v_appointment_id;
exception
  when unique_violation then
    raise exception 'This demo slot has already been booked. Please choose another time.';
end;
$function$;

create or replace function public.set_demo_appointment_status(p_appointment_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_session public.demo_sessions%rowtype;
begin
  if v_uid is null or coalesce((auth.jwt()->>'is_anonymous')::boolean, false) is not true then
    raise exception 'A demo guest session is required';
  end if;
  if p_status not in ('confirmed','cancelled','completed') then
    raise exception 'Invalid demo status';
  end if;
  select * into v_session from public.demo_sessions
    where owner_id = v_uid and expires_at > now() for update;
  if not found then raise exception 'Demo session expired'; end if;

  if v_session.role = 'doctor' then
    update public.demo_appointments set status = p_status
      where id = p_appointment_id and owner_id = v_uid
        and doctor_id = v_session.demo_doctor_id;
  elsif v_session.role = 'patient' and p_status = 'cancelled' then
    update public.demo_appointments set status = 'cancelled'
      where id = p_appointment_id and owner_id = v_uid
        and patient_id in (select id from public.demo_patients where owner_id = v_uid);
  else
    raise exception 'This action is not allowed for the current demo role';
  end if;

  if not found then raise exception 'Demo appointment not found or action not allowed'; end if;
end;
$function$;

create or replace function public.reset_demo_session()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_role text;
begin
  if v_uid is null or coalesce((auth.jwt()->>'is_anonymous')::boolean, false) is not true then
    raise exception 'A demo guest session is required';
  end if;
  select role into v_role from public.demo_sessions where owner_id = v_uid and expires_at > now() for update;
  if v_role is null then raise exception 'No active demo session'; end if;
  delete from public.demo_sessions where owner_id = v_uid;
  return public.start_demo_session(v_role);
end;
$function$;

revoke all on function public.start_demo_session(text) from public, anon;
revoke all on function public.book_demo_appointment(uuid,uuid,text) from public, anon;
revoke all on function public.set_demo_appointment_status(uuid,text) from public, anon;
revoke all on function public.reset_demo_session() from public, anon;
grant execute on function public.start_demo_session(text) to authenticated;
grant execute on function public.book_demo_appointment(uuid,uuid,text) to authenticated;
grant execute on function public.set_demo_appointment_status(uuid,text) to authenticated;
grant execute on function public.reset_demo_session() to authenticated;
