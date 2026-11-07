-- Tests for 0002 tasks engine. Runs after rls_foundation.sql on the same database.
\set ON_ERROR_STOP on
\i supabase/tests/fixture_templates.sql

update public.team_members set email = 'gianluca@bella.test' where name = 'Gianluca Muzzillo';

-- ---------- staff creates a trip: templates fire ----------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
set role authenticated;
insert into public.trips (tenant_id, name, trip_type, sales_stage, start_date, end_date, lead_id)
select t.id, 'Template test', 'Small Group', 'Proposal', current_date + 200, current_date + 208, m.id
from public.tenants t join public.team_members m on m.tenant_id = t.id where m.name = 'Gianluca Muzzillo';

do $$ declare tr uuid := (select id from public.trips where name = 'Template test'); begin
  assert (select count(*) from public.tasks where trip_id = tr) = 12, 'Proposal (5) + all trip-stage (7) templates generated';
  assert (select count(*) from public.tasks where trip_id = tr and gate is not null) = 7, 'trip-stage tasks are gated';
  assert (select count(*) from public.tasks where trip_id = tr and name = 'Confirm hotel bookings' and gate = 1) = 1, 'Book Trip -> gate 1';
  assert (select count(*) from public.tasks where trip_id = tr and name = 'Invoice paid in full' and gate = 2
            and due_date = current_date + 200 - 45) = 1, '45 days out -> gate 2, due trip_start-45';
  assert (select count(*) from public.tasks k join public.task_assignees a on a.task_id = k.id
          join public.team_members m on m.id = a.team_member_id
          where k.trip_id = tr and m.name = 'Gianluca Muzzillo') = 12, 'lead assigned by default';
  assert (select count(*) from public.task_reminders r join public.tasks k on k.id = r.task_id where k.trip_id = tr) = 12, 'reminders created';
  assert (select count(*) from public.trip_stage_events where trip_id = tr and stage_system = 'sales'
            and to_value = 'Proposal' and actor_user_id = '00000000-0000-0000-0000-00000000000b') = 1, 'creation logged';
end $$;

update public.trips set sales_stage = 'In Creation' where name = 'Template test';
update public.trips set sales_stage = 'Proposal'    where name = 'Template test';
update public.trips set sales_stage = 'In Creation' where name = 'Template test';
update public.trips set trip_stage = 1 where name = 'Template test';
do $$ declare tr uuid := (select id from public.trips where name = 'Template test'); begin
  assert (select count(*) from public.tasks where trip_id = tr) = 16, 'In Creation adds 4, re-entering stages adds none';
  assert (select count(*) from public.trip_stage_events where trip_id = tr) = 5, '4 sales events + 1 trip-stage event';
  assert (select sales_stage_entered_at is not null and trip_stage_entered_at is not null from public.trips where id = tr), 'stage timestamps';
  assert public.regenerate_trip_tasks(tr) = 0, 'regenerate is idempotent';
end $$;

-- staff cannot edit templates or call the reminder job
do $$ begin
  begin
    insert into public.task_templates (tenant_id, stage_system, stage, name) select id, 'sales', 'Proposal', 'x' from public.tenants;
    raise exception 'FAIL: staff wrote a template';
  exception when insufficient_privilege then null; end;
  begin
    perform * from public.due_reminders(current_date);
    raise exception 'FAIL: staff called due_reminders';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- ---------- other-tenant staff can't touch it ----------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', false);
set role authenticated;
do $$ begin
  begin
    perform public.regenerate_trip_tasks((select id from public.trips where name = 'Template test'));
    raise exception 'FAIL: regenerate across tenants';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  assert (select count(*) from public.task_templates) = 0, 'other tenant sees no Bella templates';
  assert (select count(*) from public.trip_stage_events e join public.tenants t on t.id = e.tenant_id where t.slug = 'bella') = 0, 'other tenant sees no Bella stage events';
  assert (select count(*) from public.tenants where slug = 'bella') = 0, 'other tenant cannot see Bella';
end $$;
-- a trip in a tenant with no templates gets no tasks
insert into public.trips (tenant_id, name, sales_stage) select id, 'Other templ test', 'Proposal' from public.tenants;
reset role;
do $$ begin
  assert (select count(*) from public.tasks k join public.trips t on t.id = k.trip_id where t.name = 'Other templ test') = 0, 'no cross-tenant templates';
end $$;

-- ---------- admin edits templates ----------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
set role authenticated;
insert into public.task_templates (tenant_id, stage_system, stage, trip_types, name, due_anchor, due_offset_days, reminder_offsets)
select id, 'sales', 'Client Review', '{B2B}', 'B2B-only review task', 'stage_entered', 1, '{1}' from public.tenants;
reset role;

-- ---------- reminder job ----------
do $$ declare n int; begin
  -- 'Move Nutshell lead to Proposal' is due today+1 with a 1-day reminder -> fires today.
  select count(*) into n from public.due_reminders(current_date) d where d.task_name = 'Move Nutshell lead to Proposal';
  assert n = 1, 'due reminder found for today';
  assert (select count(*) from public.due_reminders(current_date) where member_email is null) = 0, 'only members with email';
  assert (select count(*) from public.due_reminders(current_date) d join public.tasks k on k.id = d.task_id
          join public.trips t on t.id = k.trip_id where k.gate is not null and t.trip_stage < k.gate) = 0, 'queued tasks never remind';
  insert into public.reminder_sends (tenant_id, reminder_id, team_member_id, for_date)
  select tenant_id, reminder_id, team_member_id, current_date from public.due_reminders(current_date);
  assert (select count(*) from public.due_reminders(current_date)) = 0, 'sent reminders are not repeated';
end $$;

-- B2B-only template applies only to B2B trips
update public.trips set sales_stage = 'Client Review' where name = 'Template test';
do $$ begin
  assert (select count(*) from public.tasks where name = 'B2B-only review task') = 0, 'Small Group trip skips B2B template';
end $$;
update public.trips set trip_type = 'B2B' where name = 'Template test';
do $$ begin
  assert (select count(*) from public.tasks where name = 'B2B-only review task') = 1, 'changing type to B2B applies it';
end $$;

\echo 'ALL TASKS ENGINE TESTS PASSED'
