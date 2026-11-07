-- Tests for 0006 trip details: destinations list admin + staff editing details.
\set ON_ERROR_STOP on
select set_config('test.bella', (select id::text from public.tenants where slug = 'bella'), false);
insert into public.trips (tenant_id, name, trip_type, sales_stage, details)
select id, 'Details test', 'Custom/Private', 'Client Review', '{"destinations":["Rome","Calabria"]}' from public.tenants where slug = 'bella';

-- staff can save details (incl. ticking Heritage, which adds its checklist) but not change the list
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
set role authenticated;
update public.trips set details = details || '{"pax_min":2,"pax_max":4,"heritage":true,"gift":{"kind":"MBV","rooms":2}}'
where name = 'Details test';
do $$ begin
  assert (select details->>'pax_max' from public.trips where name = 'Details test') = '4', 'staff saved details';
  assert (select count(*) from public.tasks k join public.trips t on t.id = k.trip_id
          where t.name = 'Details test' and 'heritage' = any (k.tags)) > 0, 'heritage checklist added';
  begin
    perform public.admin_add_list_item(current_setting('test.bella')::uuid, 'destinations', 'Capri');
    raise exception 'FAIL: staff added a destination';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- admin adds and renames a destination; rename reaches trips, without touching their tasks
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
set role authenticated;
do $$
declare t uuid := current_setting('test.bella')::uuid; n integer; out jsonb;
begin
  select count(*) into n from public.tasks k join public.trips r on r.id = k.trip_id where r.name = 'Details test';
  out := public.admin_add_list_item(t, 'destinations', 'Capri');
  assert out ? 'Capri', 'destination added';
  perform public.admin_rename_list_item(t, 'destinations', 'Rome', 'Roma');
  assert (select details->'destinations' from public.trips where name = 'Details test') = '["Roma","Calabria"]'::jsonb, 'trip destination renamed';
  assert (select count(*) from public.tasks k join public.trips r on r.id = k.trip_id where r.name = 'Details test') = n, 'rename added no tasks';
  out := public.admin_remove_list_item(t, 'destinations', 'Capri');
  assert not out ? 'Capri', 'destination removed';
end $$;
reset role;
\echo ALL TRIP-DETAILS TESTS PASSED
