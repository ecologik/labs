-- Tests for 0011: admins invite people to log in, see logins, remove them.
\set ON_ERROR_STOP on
select set_config('test.bella', (select id::text from public.tenants where slug = 'bella'), false);
select set_config('test.other', (select id::text from public.tenants where slug = 'other'), false);
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000f1', 'existing@bella.test');
insert into public.team_members (tenant_id, name) select id, 'Other Person' from public.tenants where slug = 'other';

-- staff cannot use any of it
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
set role authenticated;
do $$ begin
  begin perform public.admin_access_list(current_setting('test.bella')::uuid); raise exception 'FAIL: staff listed logins';
  exception when insufficient_privilege then null; end;
  begin perform public.admin_invite(current_setting('test.bella')::uuid, 'x@y.test', 'admin',
          (select id from public.team_members where name = 'Lulu' limit 1), null); raise exception 'FAIL: staff invited';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- admin of bella
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
set role authenticated;
do $$
declare t uuid := current_setting('test.bella')::uuid; tm uuid; g uuid; r text; n int; inv uuid; lg uuid;
begin
  assert (select count(*) from public.admin_access_list(t) where kind = 'login') = 3, 'three bella logins';
  assert (select count(*) from public.admin_access_list(t) where is_me) = 1, 'admin sees themself';
  begin perform public.admin_access_list(current_setting('test.other')::uuid); raise exception 'FAIL: cross-tenant list';
  exception when insufficient_privilege then null; end;

  select id into tm from public.team_members where tenant_id = t and id not in (select team_member_id from public.memberships where team_member_id is not null) and active limit 1;
  r := public.admin_invite(t, '  New.Person@Bella.TEST ', 'staff', tm, null);
  assert r = 'invited', 'new email is invited';
  assert (select email from public.admin_access_list(t) where kind = 'invite' and team_member_id = tm) = 'new.person@bella.test', 'email normalised';
  -- re-invite same person with another email replaces the open invite
  r := public.admin_invite(t, 'new2@bella.test', 'admin', tm, null);
  assert (select count(*) from public.admin_access_list(t) where kind = 'invite' and team_member_id = tm) = 1, 'one invite per person';
  assert (select role from public.admin_access_list(t) where kind = 'invite' and team_member_id = tm) = 'admin', 're-invite changes role';

  begin perform public.admin_invite(t, 'bad-email', 'staff', tm, null); raise exception 'FAIL: bad email';
  exception when raise_exception then null; end;
  begin perform public.admin_invite(t, 'a@b.test', 'guide', tm, null); raise exception 'FAIL: team member as guide';
  exception when raise_exception then null; end;
  begin perform public.admin_invite(t, 'a@b.test', 'staff', null, null); raise exception 'FAIL: nobody';
  exception when raise_exception then null; end;
  begin perform public.admin_invite(t, 'a@b.test', 'staff', (select id from public.team_members where tenant_id = current_setting('test.other')::uuid limit 1), null); raise exception 'FAIL: other tenant person';
  exception when raise_exception then null; end;

  -- an email that already signed in gets access right away
  select id into g from public.guides where tenant_id = t and team_member_id is null and id not in (select guide_id from public.memberships where guide_id is not null) and active limit 1;
  r := public.admin_invite(t, 'existing@bella.test', 'guide', null, g);
  assert r = 'granted', 'existing user granted';
  assert exists (select 1 from public.admin_access_list(t) where kind = 'login' and guide_id = g and email = 'existing@bella.test'), 'guide login listed';
  begin perform public.admin_invite(t, 'z@b.test', 'staff', null, g); raise exception 'FAIL: guide as staff';
  exception when raise_exception then null; end;

  -- changing an existing login's role
  r := public.admin_invite(t, 'ignored@x.test', 'admin', (select team_member_id from public.memberships where user_id = '00000000-0000-0000-0000-00000000000b'), null);
  assert r = 'updated', 'existing login updated';
  assert (select role from public.memberships where user_id = '00000000-0000-0000-0000-00000000000b') = 'admin', 'role changed';
  begin perform public.admin_invite(t, 'x@x.test', 'staff', (select team_member_id from public.memberships where user_id = auth.uid()), null); raise exception 'FAIL: self demote';
  exception when raise_exception then null; end;

  -- revoke
  select id into inv from public.admin_access_list(t) where kind = 'invite' and team_member_id = tm;
  perform public.admin_revoke_access(t, 'invite', inv);
  assert not exists (select 1 from public.admin_access_list(t) where kind = 'invite' and team_member_id = tm), 'invite cancelled';
  select id into lg from public.admin_access_list(t) where kind = 'login' and guide_id = g;
  perform public.admin_revoke_access(t, 'login', lg);
  assert not exists (select 1 from public.admin_access_list(t) where kind = 'login' and guide_id = g), 'login removed';
  begin perform public.admin_revoke_access(t, 'login', (select id from public.admin_access_list(t) where is_me)); raise exception 'FAIL: removed self';
  exception when raise_exception then null; end;
  -- cannot touch other tenant's rows
  perform public.admin_revoke_access(t, 'login', (select id from public.memberships where user_id = '00000000-0000-0000-0000-00000000000d'));
end $$;
reset role;
do $$ begin
  assert exists (select 1 from public.memberships where user_id = '00000000-0000-0000-0000-00000000000d'), 'other tenant login untouched';
end $$;
\echo ALL INVITE TESTS PASSED
