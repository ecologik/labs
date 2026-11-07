-- Tests for 0005 removing tasks. Runs after the other suites.
\set ON_ERROR_STOP on
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
set role authenticated;
insert into public.trips (tenant_id, name, trip_type, sales_stage, start_date, end_date, details)
select id, 'Remove test', 'Custom/Private', 'Proposal', current_date + 100, current_date + 110, '{"heritage":true}' from public.tenants;
-- remove one sales task and one heritage task
update public.tasks set dismissed_at = now()
where trip_id = (select id from public.trips where name = 'Remove test') and name in ('Add proposal to Softrip', 'Create heritage research folder in Drive');
-- re-enter Proposal, re-tick Heritage, regenerate: nothing comes back
update public.trips set sales_stage = 'In Creation' where name = 'Remove test';
update public.trips set sales_stage = 'Proposal' where name = 'Remove test';
update public.trips set details = details || '{"heritage":false}' where name = 'Remove test';
update public.trips set details = details || '{"heritage":true}' where name = 'Remove test';
do $$ declare tr uuid := (select id from public.trips where name = 'Remove test'); begin
  perform public.regenerate_trip_tasks(tr);
  assert (select count(*) from public.tasks where trip_id = tr and name = 'Add proposal to Softrip') = 1, 'removed sales task not re-added';
  assert (select count(*) from public.tasks where trip_id = tr and name = 'Create heritage research folder in Drive') = 1, 'removed heritage task not re-added';
  assert (select count(*) from public.tasks where trip_id = tr and dismissed_at is not null
            and dismissed_by = '00000000-0000-0000-0000-00000000000b') = 2, 'removal stamped';
  assert (select count(*) from public.task_activity a join public.tasks k on k.id = a.task_id
          where k.trip_id = tr and a.action = 'removed') = 2, 'removal logged';
end $$;
-- hand-added task can be hard-deleted
insert into public.tasks (tenant_id, trip_id, name) select tenant_id, id, 'Manual one' from public.trips where name = 'Remove test';
delete from public.tasks where name = 'Manual one';
do $$ begin assert (select count(*) from public.tasks where name = 'Manual one') = 0, 'manual delete'; end $$;
reset role;
-- removed tasks never remind
do $$ declare tr uuid := (select id from public.trips where name = 'Remove test'); begin
  update public.tasks set due_date = current_date + 1 where trip_id = tr;
  assert (select count(*) from public.due_reminders(current_date) d join public.tasks k on k.id = d.task_id
          where k.trip_id = tr and k.dismissed_at is not null) = 0, 'removed tasks skipped by reminders';
end $$;
\echo 'ALL REMOVE-TASK TESTS PASSED'
