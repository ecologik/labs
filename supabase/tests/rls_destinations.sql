-- Tests for 0009 destination merge / delete.
\set ON_ERROR_STOP on
select set_config('test.bella', (select id::text from public.tenants where slug = 'bella'), false);
update public.tenants set settings = jsonb_set(settings, '{destinations}', '["Rome","Sicily","Calabria"]') where slug = 'bella';
insert into public.trips (tenant_id, name, details)
select id, x.n, x.d::jsonb from public.tenants, (values
  ('Dest A', '{"destinations":["Rome","Siciliy","Sicily"]}'),
  ('Dest B', '{"destinations":["Siciliy","Calabria"],"heritage":false}'),
  ('Dest C', '{"destinations":["Rome"]}'),
  ('Dest D', '{}')) x(n, d)
where slug = 'bella';
insert into public.trips (tenant_id, name, details)
select id, 'Dest other tenant', '{"destinations":["Siciliy"]}' from public.tenants where slug <> 'bella' limit 1;

-- staff can't
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
set role authenticated;
do $$ begin
  begin perform public.admin_merge_destination(current_setting('test.bella')::uuid, 'Siciliy', 'Sicily'); raise exception 'FAIL: staff merged';
  exception when insufficient_privilege then null; end;
  begin perform public.admin_delete_destination(current_setting('test.bella')::uuid, 'Rome'); raise exception 'FAIL: staff deleted';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
set role authenticated;
do $$
declare t uuid := current_setting('test.bella')::uuid; out jsonb;
begin
  -- merge a trip-only typo into a listed destination: no duplicates, order kept
  out := public.admin_merge_destination(t, 'Siciliy', 'Sicily');
  assert (out ->> 'trips')::int = 2, 'two trips changed: ' || out;
  assert (select details -> 'destinations' from public.trips where name = 'Dest A') = '["Rome","Sicily"]', 'deduped';
  assert (select details -> 'destinations' from public.trips where name = 'Dest B') = '["Sicily","Calabria"]', 'replaced in place';
  assert out -> 'list' = '["Rome","Sicily","Calabria"]', 'list unchanged';

  -- merge a listed one into a new name: it takes the old one's place in the list
  out := public.admin_merge_destination(t, 'Calabria', 'Calabria & Basilicata');
  assert out -> 'list' = '["Rome","Sicily","Calabria & Basilicata"]', 'new name took its place: ' || (out -> 'list');
  assert (select details -> 'destinations' from public.trips where name = 'Dest B') = '["Sicily","Calabria & Basilicata"]', 'trip renamed';

  -- delete removes it from list and trips
  out := public.admin_delete_destination(t, 'Rome');
  assert (out ->> 'trips')::int = 2, 'Rome on two trips';
  assert out -> 'list' = '["Sicily","Calabria & Basilicata"]', 'Rome off the list';
  assert (select details -> 'destinations' from public.trips where name = 'Dest C') = '[]', 'Rome off trip C';
  assert (select details from public.trips where name = 'Dest D') = '{}', 'trip without destinations untouched';

  begin perform public.admin_merge_destination(t, 'Sicily', ' Sicily '); raise exception 'FAIL: merge into itself';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; end;
end $$;
reset role;
do $$ begin
  assert (select details -> 'destinations' from public.trips where name = 'Dest other tenant') = '["Siciliy"]', 'other tenant untouched';
end $$;
\echo ALL DESTINATION TESTS PASSED
