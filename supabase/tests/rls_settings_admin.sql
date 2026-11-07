-- Tests for 0003 settings admin. Runs after the tasks-engine tests on the same database.
\set ON_ERROR_STOP on
select set_config('test.bella', (select id::text from public.tenants where slug = 'bella'), false);

-- staff can't change lists
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
set role authenticated;
do $$ begin
  begin
    perform public.admin_add_list_item(current_setting('test.bella')::uuid, 'trip_types', 'Wedding');
    raise exception 'FAIL: staff added a list item';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- other tenant's admin can't touch Bella (d is staff in other; make a fresh admin there)
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000f0', 'admin@other.test');
insert into public.memberships (tenant_id, user_id, role) select id, '00000000-0000-0000-0000-0000000000f0', 'admin' from public.tenants where slug = 'other';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f0', false);
set role authenticated;
do $$ begin
  begin
    perform public.admin_add_list_item(current_setting('test.bella')::uuid, 'trip_types', 'Wedding');
    raise exception 'FAIL: other tenant admin changed Bella';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- Bella admin
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
set role authenticated;
do $$ declare t uuid := current_setting('test.bella')::uuid; out jsonb; ev_before int; begin
  -- add
  out := public.admin_add_list_item(t, 'trip_types', 'Wedding');
  assert out ? 'Wedding', 'trip type added';
  out := public.admin_add_list_item(t, 'sales_stages', 'Inquiry', 'Proposal');
  assert out->>0 = 'Inquiry' and out->>1 = 'Proposal', 'sales stage inserted before Proposal';
  out := public.admin_add_list_item(t, 'trip_stages', 'Wrap-up');
  assert out->>(jsonb_array_length(out)-1) = 'Wrap-up', 'trip stage appended';
  begin
    perform public.admin_add_list_item(t, 'trip_stages', 'Early', 'Paid Deposit');
    raise exception 'FAIL: inserted trip stage in the middle';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; end;
  begin
    perform public.admin_add_list_item(t, 'trip_types', 'wedding ');  -- trimmed, different case = allowed
  exception when others then raise exception 'FAIL: % ', sqlerrm; end;
  begin
    perform public.admin_add_list_item(t, 'trip_types', 'Wedding');
    raise exception 'FAIL: duplicate allowed';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; end;

  -- rename a sales stage that has trips + templates; no new stage events, no new tasks
  select count(*) into ev_before from public.trip_stage_events;
  perform public.admin_rename_list_item(t, 'sales_stages', 'Proposal', 'Proposal Sent');
  assert (select count(*) from public.trips where tenant_id = t and sales_stage = 'Proposal') = 0, 'no trips left on old name';
  assert (select count(*) from public.trips where tenant_id = t and sales_stage = 'Proposal Sent') > 0, 'trips renamed';
  assert (select count(*) from public.task_templates where tenant_id = t and stage = 'Proposal') = 0, 'templates renamed';
  assert (select count(*) from public.trip_stage_events) = ev_before, 'rename is not a stage move';

  -- rename trip type everywhere
  perform public.admin_rename_list_item(t, 'trip_types', 'Small Group', 'Small Group Tour');
  assert (select count(*) from public.trips where tenant_id = t and trip_type = 'Small Group') = 0, 'trip type renamed on trips';

  -- remove guards
  begin
    perform public.admin_remove_list_item(t, 'sales_stages', 'Proposal Sent');
    raise exception 'FAIL: removed a stage in use';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; end;
  begin
    perform public.admin_remove_list_item(t, 'trip_stages', 'Arrived');
    raise exception 'FAIL: removed a middle trip stage';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; end;
  out := public.admin_remove_list_item(t, 'trip_stages', 'Wrap-up');
  assert not out ? 'Wrap-up', 'empty last trip stage removed';
  out := public.admin_remove_list_item(t, 'sales_stages', 'Inquiry');
  assert not out ? 'Inquiry', 'empty sales stage removed';
  out := public.admin_remove_list_item(t, 'trip_types', 'wedding');
  assert not out ? 'wedding', 'unused trip type removed';
end $$;

-- admin creates a template in a NEW bucket, it fires for a new trip
do $$ declare t uuid := current_setting('test.bella')::uuid; begin
  perform public.admin_add_list_item(t, 'sales_stages', 'Deposit Chase');
end $$;
insert into public.task_templates (tenant_id, stage_system, stage, trip_types, name, task_type)
values (current_setting('test.bella')::uuid, 'sales', 'Deposit Chase', '{Wedding}', 'Chase wedding deposit', 'Financial');
insert into public.trips (tenant_id, name, trip_type, sales_stage) values (current_setting('test.bella')::uuid, 'Wedding trip', 'Wedding', 'Deposit Chase');
reset role;
do $$ begin
  assert (select count(*) from public.tasks k join public.trips t on t.id = k.trip_id
          where t.name = 'Wedding trip' and k.name = 'Chase wedding deposit') = 1, 'new bucket template fires';
end $$;

\echo 'ALL SETTINGS ADMIN TESTS PASSED'
