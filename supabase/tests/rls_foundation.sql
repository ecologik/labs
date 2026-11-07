-- RLS + integrity tests for the foundation migration. Run against plain Postgres
-- after stub_supabase.sql, the migration and seed.sql (see run_tests.sh).
-- Every check raises on failure, so the script exits non-zero on the first bug.
\set ON_ERROR_STOP on

-- ---------- fixtures (as superuser) ----------
insert into public.tenants (slug, name) values ('other', 'Other Client');

insert into public.invitations (tenant_id, email, role, team_member_id)
select t.id, 'Admin@Bella.test', 'admin', m.id from public.tenants t join public.team_members m on m.tenant_id = t.id
where t.slug = 'bella' and m.name = 'Cherrye Moore';
insert into public.invitations (tenant_id, email, role, team_member_id)
select t.id, 'staff@bella.test', 'staff', m.id from public.tenants t join public.team_members m on m.tenant_id = t.id
where t.slug = 'bella' and m.name = 'Gianluca Muzzillo';
insert into public.invitations (tenant_id, email, role, guide_id)
select t.id, 'guide@bella.test', 'guide', g.id from public.tenants t join public.guides g on g.tenant_id = t.id
where t.slug = 'bella' and g.name = 'Domenico Boi';
insert into public.invitations (tenant_id, email, role)
select id, 'staff@other.test', 'staff' from public.tenants where slug = 'other';

-- Signing up claims the invitation (email match is case-insensitive).
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@bella.test'),
  ('00000000-0000-0000-0000-00000000000b', 'staff@bella.test'),
  ('00000000-0000-0000-0000-00000000000c', 'guide@bella.test'),
  ('00000000-0000-0000-0000-00000000000d', 'staff@other.test'),
  ('00000000-0000-0000-0000-00000000000e', 'nobody@nowhere.test');

do $$ begin
  assert (select count(*) from public.memberships) = 4, 'invitations should become 4 memberships';
  assert (select count(*) from public.invitations where accepted_at is null) = 0, 'all invitations accepted';
end $$;

\i supabase/seed.demo.sql
insert into public.trips (tenant_id, name) select id, 'Other tenant trip' from public.tenants where slug = 'other';
insert into public.tasks (tenant_id, trip_id, name)
select t.id, tr.id, 'Other tenant task' from public.tenants t join public.trips tr on tr.tenant_id = t.id where t.slug = 'other';

-- helper to impersonate
create or replace function pg_temp.act_as(u text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', u, false);
end $$;

-- ---------- Bella staff ----------
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
set role authenticated;
do $$ begin
  assert (select count(*) from public.tenants) = 1, 'staff sees only own tenant';
  assert (select count(*) from public.trips) = 3, 'staff sees 3 Bella trips, not other tenant';
  assert (select count(*) from public.tasks) = 5, 'staff sees 5 Bella tasks';
  assert (select count(*) from public.team_members) = 5, 'staff reads roster';
  assert (select count(*) from public.memberships) = 1, 'staff sees only own membership';
  assert (select count(*) from public.invitations) = 0, 'staff cannot see invitations';
end $$;

-- staff moves a task -> activity logged with actor
update public.tasks set status = 'Complete' where name = 'Add proposal to Softrip';
do $$ begin
  assert (select count(*) from public.task_activity a join public.tasks k on k.id = a.task_id
          where k.name = 'Add proposal to Softrip' and a.action = 'status' and a.to_value = 'Complete'
            and a.actor_user_id = '00000000-0000-0000-0000-00000000000b'
            and a.actor_member_id is not null) = 1, 'status change logged with actor';
  assert (select completed_at is not null from public.tasks where name = 'Add proposal to Softrip'), 'completed_at set';
end $$;

-- staff cannot write into another tenant
reset role;
do $$ declare other uuid := (select id from public.tenants where slug = 'other'); begin
  perform set_config('test.other', other::text, false);
end $$;
set role authenticated;
do $$ begin
  begin
    insert into public.trips (tenant_id, name) values (current_setting('test.other')::uuid, 'sneaky');
    raise exception 'FAIL: staff inserted a trip into another tenant';
  exception when insufficient_privilege then null; end;
end $$;
-- updates/deletes on other tenant rows silently affect nothing
update public.trips set name = 'hacked' where tenant_id = current_setting('test.other')::uuid;
delete from public.tasks where tenant_id = current_setting('test.other')::uuid;
-- staff cannot write the audit log or edit the roster or settings
do $$ begin
  begin
    insert into public.task_activity (tenant_id, task_id, action) select tenant_id, id, 'forged' from public.tasks limit 1;
    raise exception 'FAIL: staff wrote task_activity directly';
  exception when insufficient_privilege then null; end;
end $$;
update public.team_members set name = 'renamed by staff';
update public.tenants set name = 'renamed by staff';
-- staff cannot promote themselves
update public.memberships set role = 'admin';
-- staff cannot attach a task to a trip of another tenant (composite FK)
do $$ declare k uuid := (select id from public.tasks limit 1); begin
  begin
    reset role;
    update public.tasks set trip_id = (select id from public.trips where name = 'Other tenant trip') where id = k;
    raise exception 'FAIL: cross-tenant trip link accepted';
  exception when foreign_key_violation then null; end;
end $$;
reset role;
do $$ begin
  assert (select count(*) from public.trips where name in ('hacked','sneaky')) = 0, 'other tenant trips untouched';
  assert (select count(*) from public.tasks where name = 'Other tenant task') = 1, 'other tenant task not deleted';
  assert (select count(*) from public.team_members where name = 'renamed by staff') = 0, 'staff cannot edit roster';
  assert (select count(*) from public.tenants where name = 'renamed by staff') = 0, 'staff cannot edit tenant';
  assert (select role from public.memberships where user_id = '00000000-0000-0000-0000-00000000000b') = 'staff', 'no self-promotion';
end $$;

-- ---------- Bella guide ----------
select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
set role authenticated;
do $$ begin
  assert (select count(*) from public.tenants) = 1, 'guide sees own tenant';
  assert (select count(*) from public.guides) = 5, 'guide reads guide list';
  assert (select count(*) from public.trips) = 0, 'guide sees no trips in foundation';
  assert (select count(*) from public.tasks) = 0, 'guide sees no tasks';
  assert (select count(*) from public.team_members) = 0, 'guide cannot read staff roster';
end $$;
update public.guides set name = 'changed by guide';
reset role;
do $$ begin
  assert (select count(*) from public.guides where name = 'changed by guide') = 0, 'guide is read-only';
end $$;

-- ---------- Bella admin ----------
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
set role authenticated;
do $$ begin
  assert (select count(*) from public.memberships) = 3, 'admin sees all Bella memberships only';
  assert public.my_role((select id from public.tenants)) = 'admin', 'my_role works';
end $$;
update public.tenants set settings = settings || '{"trip_stages":["Paid Deposit","Book Trip","45 days out","Arrived","Post-Trip"]}';
insert into public.invitations (tenant_id, email, role) select id, 'new@bella.test', 'staff' from public.tenants;
reset role;
do $$ begin
  assert (select jsonb_array_length(settings->'trip_stages') from public.tenants where slug = 'bella') = 5, 'admin edits settings';
  assert (select count(*) from public.invitations where email = 'new@bella.test') = 1, 'admin invites';
end $$;

-- ---------- outsider + anon ----------
select pg_temp.act_as('00000000-0000-0000-0000-00000000000e');
set role authenticated;
do $$ begin
  assert (select count(*) from public.tenants) = 0, 'outsider sees no tenants';
  assert (select count(*) from public.trips) = 0, 'outsider sees no trips';
end $$;
reset role;
select pg_temp.act_as('');
set role anon;
do $$ begin
  begin
    perform 1 from public.trips;
    raise exception 'FAIL: anon can query trips';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- ---------- existing user claims a later invitation ----------
insert into public.invitations (tenant_id, email, role)
select id, 'nobody@nowhere.test', 'staff' from public.tenants where slug = 'other';
select pg_temp.act_as('00000000-0000-0000-0000-00000000000e');
set role authenticated;
do $$ begin
  assert public.claim_invitations() = 1, 'claim_invitations creates membership';
  assert (select count(*) from public.trips) = 1, 'now sees the other tenant trip only';
end $$;
reset role;

\echo 'ALL RLS TESTS PASSED'
