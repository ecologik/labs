-- Tests for 0007 guide schedule.
\set ON_ERROR_STOP on
insert into public.trips (tenant_id, name, start_date, end_date)
select id, 'Schedule test', '2027-08-05', '2027-08-11' from public.tenants where slug = 'bella';

-- Bella staff can add, move and delete segments
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
set role authenticated;
insert into public.trip_segments (tenant_id, trip_id, label, start_date, end_date, guide_id)
select t.tenant_id, t.id, 'Guided Palermo', '2027-08-07', '2027-08-10', (select id from public.guides g where g.tenant_id = t.tenant_id limit 1)
from public.trips t where t.name = 'Schedule test';
insert into public.trip_segments (tenant_id, trip_id, label, start_date, end_date)
select tenant_id, id, 'On their own', '2027-08-05', '2027-08-06' from public.trips where name = 'Schedule test';
update public.trip_segments set start_date = '2027-08-08', end_date = '2027-08-11' where label = 'Guided Palermo';
do $$ begin
  assert (select count(*) from public.trip_segments) = 2, 'staff see their segments';
  begin
    update public.trip_segments set end_date = '2027-08-01' where label = 'On their own';
    raise exception 'FAIL: end before start accepted';
  exception when check_violation then null; end;
end $$;
reset role;

-- a user from another tenant sees none and can't add to Bella's trip
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', false);
set role authenticated;
do $$ begin
  assert (select count(*) from public.trip_segments) = 0, 'other tenant sees no segments';
  begin
    insert into public.trip_segments (tenant_id, trip_id, label, start_date, end_date)
    select tenant_id, id, 'x', '2027-08-05', '2027-08-05' from public.trips where name = 'Schedule test';
    if found then raise exception 'FAIL: other tenant inserted'; end if;
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- deleting the trip removes its segments
delete from public.trips where name = 'Schedule test';
do $$ begin assert (select count(*) from public.trip_segments) = 0, 'segments cascade with trip'; end $$;
\echo ALL GUIDE-SCHEDULE TESTS PASSED
