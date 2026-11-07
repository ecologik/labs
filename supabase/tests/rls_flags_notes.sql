-- Tests for 0004 trip flags (Heritage) + task notes. Runs after the other suites.
\set ON_ERROR_STOP on
\i supabase/tests/fixture_templates.sql
do $$ begin
  assert (select settings->'trip_flags'->0->>'key' from public.tenants where slug = 'bella') = 'heritage', 'seed set trip_flags';
  assert (select count(*) from public.task_templates where stage_system = 'flag' and stage = 'heritage') = 3, '3 heritage templates';
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
set role authenticated;
-- created with Heritage on
insert into public.trips (tenant_id, name, trip_type, sales_stage, start_date, end_date, details)
select id, 'Heritage on create', 'Custom/Private', 'Client Review', current_date + 120, current_date + 130, '{"heritage":true}' from public.tenants;
-- created without, ticked later
insert into public.trips (tenant_id, name, trip_type, sales_stage, start_date, end_date, details)
select id, 'Heritage later', 'Custom/Private', 'Client Review', current_date + 120, current_date + 130, '{"heritage":false}' from public.tenants;
do $$ begin
  assert (select count(*) from public.tasks k join public.trips t on t.id = k.trip_id
          where t.name = 'Heritage on create' and k.tags = '{heritage}') = 3, 'heritage tasks on create, tagged';
  assert (select count(*) from public.tasks k join public.trips t on t.id = k.trip_id
          where t.name = 'Heritage later' and 'heritage' = any (k.tags)) = 0, 'no heritage tasks when unticked';
  assert (select count(*) from public.tasks k join public.trips t on t.id = k.trip_id
          where t.name = 'Heritage on create' and k.name = 'Meeting held with heritage contact'
            and k.due_date = current_date + 120 - 30 and k.gate is null) = 1, 'heritage due date from trip start, not gated';
end $$;
update public.trips set details = details || '{"heritage":true}' where name = 'Heritage later';
update public.trips set details = details || '{"heritage":false}' where name = 'Heritage later';
update public.trips set details = details || '{"heritage":true}' where name = 'Heritage later';
do $$ begin
  assert (select count(*) from public.tasks k join public.trips t on t.id = k.trip_id
          where t.name = 'Heritage later' and k.tags = '{heritage}') = 3, 'ticking later adds 3, re-ticking adds none';
end $$;

-- notes
update public.tasks set note = '  Called the hotel, confirmed.  '
where id = (select k.id from public.tasks k join public.trips t on t.id = k.trip_id where t.name = 'Heritage later' limit 1);
do $$ declare k record; begin
  select * into k from public.tasks where note is not null and note like 'Called%';
  assert k.note = 'Called the hotel, confirmed.', 'note trimmed';
  assert k.note_updated_by = '00000000-0000-0000-0000-00000000000b' and k.note_updated_at is not null, 'note stamped';
  assert (select count(*) from public.task_activity where task_id = k.id and action = 'note') = 1, 'note logged';
end $$;
update public.tasks set note = '   ' where note like 'Called%';
do $$ begin
  assert (select count(*) from public.tasks where note = '   ' or note = '') = 0, 'blank note stored as null';
end $$;
reset role;

-- guide can't read notes (no task access at all)
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
set role authenticated;
do $$ begin assert (select count(*) from public.tasks) = 0, 'guide sees no tasks'; end $$;
reset role;

-- other tenant: flag on its trip triggers nothing from Bella
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', false);
set role authenticated;
insert into public.trips (tenant_id, name, details) select id, 'Other heritage', '{"heritage":true}' from public.tenants;
reset role;
do $$ begin
  assert (select count(*) from public.tasks k join public.trips t on t.id = k.trip_id where t.name = 'Other heritage') = 0, 'no cross-tenant flag tasks';
end $$;

\echo 'ALL FLAGS + NOTES TESTS PASSED'
