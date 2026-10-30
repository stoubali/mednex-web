
-- Lock demo mutations behind narrowly validated SECURITY DEFINER RPCs.
-- RLS remains enabled; no direct table writes from browser roles.
revoke all on table public.demo_doctors, public.demo_slots, public.demo_sessions,
  public.demo_patients, public.demo_appointments from public, anon, authenticated;

grant select on table public.demo_doctors, public.demo_slots, public.demo_sessions,
  public.demo_patients, public.demo_appointments to authenticated;

-- RPCs are the only supported write path; do not permit direct DML.
revoke insert, update, delete, truncate, references, trigger on table
  public.demo_doctors, public.demo_slots, public.demo_sessions,
  public.demo_patients, public.demo_appointments from anon, authenticated;

revoke all on function public.start_demo_session(text) from public, anon;
revoke all on function public.book_demo_appointment(uuid,uuid,text) from public, anon;
revoke all on function public.set_demo_appointment_status(uuid,text) from public, anon;
revoke all on function public.reset_demo_session() from public, anon;

grant execute on function public.start_demo_session(text) to authenticated;
grant execute on function public.book_demo_appointment(uuid,uuid,text) to authenticated;
grant execute on function public.set_demo_appointment_status(uuid,text) to authenticated;
grant execute on function public.reset_demo_session() to authenticated;
