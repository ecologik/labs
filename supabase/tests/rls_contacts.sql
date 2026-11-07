-- Tests for 0010: admins edit team/guide phones; staff can read but not change them.
\set ON_ERROR_STOP on
select set_config('test.bella', (select id::text from public.tenants where slug = 'bella'), false);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
set role authenticated;
update public.team_members set phone = '+1 409 444 0000 / +39 388 000 0000' where tenant_id = current_setting('test.bella')::uuid;
update public.guides set phone = '+39 338 000 0000' where tenant_id = current_setting('test.bella')::uuid;
insert into public.guides (tenant_id, name, phone) values (current_setting('test.bella')::uuid, 'Contact Test Guide', '+39 1');
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
set role authenticated;
do $$
declare n integer;
begin
  assert (select count(*) from public.team_members where phone like '+1 409%') > 0, 'staff read team phones';
  assert (select count(*) from public.guides where name = 'Contact Test Guide') = 1, 'staff read guides';
  update public.guides set phone = 'hacked' where name = 'Contact Test Guide';
  get diagnostics n = row_count;
  assert n = 0, 'staff cannot change guides';
  update public.team_members set phone = 'hacked';
  get diagnostics n = row_count;
  assert n = 0, 'staff cannot change team';
  begin insert into public.guides (tenant_id, name) values (current_setting('test.bella')::uuid, 'Sneaky'); raise exception 'FAIL: staff added a guide';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin
  begin update public.guides set phone = repeat('9', 81) where name = 'Contact Test Guide'; raise exception 'FAIL: long phone';
  exception when check_violation then null; end;
end $$;
\echo ALL CONTACT TESTS PASSED
