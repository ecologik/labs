-- Optional demo data for a dev/staging project: a few made-up trips and tasks
-- for the Bella tenant so the screens have something to show. Do NOT run in
-- production. Names are invented (no real clients).
do $$
declare
  t uuid := (select id from public.tenants where slug = 'bella');
  cherrye uuid := (select id from public.team_members where tenant_id = t and name = 'Cherrye Moore');
  gianluca uuid := (select id from public.team_members where tenant_id = t and name = 'Gianluca Muzzillo');
  peppe uuid := (select id from public.team_members where tenant_id = t and name = 'Peppe Mannella');
  lulu uuid := (select id from public.team_members where tenant_id = t and name = 'Lulu Bianco');
  tr1 uuid; tr2 uuid; tr3 uuid; k uuid;
begin
  if t is null then raise exception 'Run seed.sql first'; end if;
  if exists (select 1 from public.trips where tenant_id = t and source = 'demo') then return; end if;

  insert into public.trips (tenant_id, name, trip_type, sales_stage, trip_stage, start_date, end_date, lead_id, details, source, external_ref)
  values (t, 'Demo — Calabria Food & Wine', 'Small Group', 'Booked', 1, current_date + 40, current_date + 49, cherrye,
          '{"destinations":["Calabria"],"heritage":true,"pax":12}', 'demo', 'demo-1')
  returning id into tr1;
  insert into public.trips (tenant_id, name, trip_type, sales_stage, trip_stage, start_date, end_date, lead_id, details, source, external_ref)
  values (t, 'Demo — Amalfi Honeymoon', 'Custom/Private', 'Client Review', 0, current_date + 120, current_date + 129, gianluca,
          '{"destinations":["Amalfi Coast","Sorrento"],"heritage":false,"pax":2}', 'demo', 'demo-2')
  returning id into tr2;
  insert into public.trips (tenant_id, name, trip_type, sales_stage, trip_stage, start_date, end_date, lead_id, details, source, external_ref)
  values (t, 'Demo — Agency Group Puglia', 'B2B', 'Proposal', 0, current_date + 300, current_date + 307, cherrye,
          '{"destinations":["Puglia"],"heritage":false,"pax":20}', 'demo', 'demo-3')
  returning id into tr3;

  insert into public.tasks (tenant_id, trip_id, name, task_type, status, due_date) values
    (t, tr1, 'Rooming list and passports collected', 'Vendor', 'In Progress', current_date - 3) returning id into k;
  insert into public.task_assignees values (t, k, peppe);
  insert into public.tasks (tenant_id, trip_id, name, task_type, status, due_date) values
    (t, tr1, 'Welcome note and gift sent', 'Vendor', 'Not Started', current_date + 30) returning id into k;
  insert into public.task_assignees values (t, k, lulu);
  insert into public.tasks (tenant_id, trip_id, name, task_type, status, due_date, gate) values
    (t, tr1, 'Final documents to client', 'Client-facing', 'Not Started', current_date + 25, 2) returning id into k;
  insert into public.task_assignees values (t, k, cherrye);
  insert into public.tasks (tenant_id, trip_id, name, task_type, status, due_date) values
    (t, tr2, 'Follow up on proposal feedback', 'Client-facing', 'Waiting on Client', current_date + 2) returning id into k;
  insert into public.task_assignees values (t, k, gianluca);
  insert into public.tasks (tenant_id, trip_id, name, task_type, status, due_date) values
    (t, tr3, 'Add proposal to Softrip', 'System Update', 'Not Started', current_date + 5) returning id into k;
  insert into public.task_assignees values (t, k, gianluca);
  insert into public.task_assignees values (t, k, cherrye);
end $$;
