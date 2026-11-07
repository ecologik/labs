-- =============================================================================
-- EcoLogik Labs — 0003 Settings admin
--   Admin-only functions to manage the tenant's lists ("buckets") safely:
--     sales_stages, trip_stages, trip_types, task_types
--   add    : append a new item (sales stages / types can also go before another item)
--   rename : renames everywhere it is used (trips, templates, tasks) in one go
--   remove : only when nothing uses it
--   Trip stages are stored on trips by POSITION, so they can only be appended,
--   and only the last one can be removed.
-- =============================================================================

create or replace function public._settings_list(p_tenant uuid, p_list text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(settings -> p_list, '[]'::jsonb) from public.tenants where id = p_tenant
$$;
revoke execute on function public._settings_list(uuid, text) from public, anon, authenticated;

create or replace function public._check_list_admin(p_tenant uuid, p_list text)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin(p_tenant) then raise exception 'Only admins can change settings' using errcode = '42501'; end if;
  if p_list not in ('sales_stages','trip_stages','trip_types','task_types') then
    raise exception 'Unknown list %', p_list;
  end if;
end $$;
revoke execute on function public._check_list_admin(uuid, text) from public, anon, authenticated;

-- ---------- add ----------
create or replace function public.admin_add_list_item(p_tenant uuid, p_list text, p_name text, p_before text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  cur jsonb; name text := btrim(p_name); out jsonb := '[]'::jsonb; item text; placed boolean := false;
begin
  perform public._check_list_admin(p_tenant, p_list);
  if name is null or name = '' then raise exception 'Name is required'; end if;
  cur := public._settings_list(p_tenant, p_list);
  if cur ? name then raise exception '"%" already exists', name; end if;
  if p_before is not null and p_list = 'trip_stages' then
    raise exception 'Trip stages can only be added at the end';
  end if;
  if p_before is null then
    out := cur || to_jsonb(name);
  else
    if not cur ? p_before then raise exception '"%" not found', p_before; end if;
    for item in select jsonb_array_elements_text(cur) loop
      if item = p_before and not placed then out := out || to_jsonb(name); placed := true; end if;
      out := out || to_jsonb(item);
    end loop;
  end if;
  update public.tenants set settings = jsonb_set(settings, array[p_list], out, true) where id = p_tenant;
  return out;
end $$;

-- ---------- rename ----------
create or replace function public.admin_rename_list_item(p_tenant uuid, p_list text, p_old text, p_new text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare cur jsonb; new_name text := btrim(p_new); out jsonb;
begin
  perform public._check_list_admin(p_tenant, p_list);
  if new_name is null or new_name = '' then raise exception 'Name is required'; end if;
  cur := public._settings_list(p_tenant, p_list);
  if not cur ? p_old then raise exception '"%" not found', p_old; end if;
  if new_name = p_old then return cur; end if;
  if cur ? new_name then raise exception '"%" already exists', new_name; end if;

  select jsonb_agg(case when e = p_old then new_name else e end order by o) into out
  from jsonb_array_elements_text(cur) with ordinality x(e, o);
  update public.tenants set settings = jsonb_set(settings, array[p_list], out, true) where id = p_tenant;

  -- A rename is not a stage move: keep it out of stage history and template generation.
  perform set_config('app.settings_rename', 'on', true);
  if p_list = 'sales_stages' then
    update public.task_templates set stage = new_name where tenant_id = p_tenant and stage_system = 'sales' and stage = p_old;
    update public.trips set sales_stage = new_name where tenant_id = p_tenant and sales_stage = p_old;
  elsif p_list = 'trip_stages' then
    update public.task_templates set stage = new_name where tenant_id = p_tenant and stage_system = 'trip' and stage = p_old;
  elsif p_list = 'trip_types' then
    update public.task_templates set trip_types = array_replace(trip_types, p_old, new_name)
      where tenant_id = p_tenant and p_old = any (trip_types);
    update public.trips set trip_type = new_name where tenant_id = p_tenant and trip_type = p_old;
  elsif p_list = 'task_types' then
    update public.task_templates set task_type = new_name where tenant_id = p_tenant and task_type = p_old;
    update public.tasks set task_type = new_name where tenant_id = p_tenant and task_type = p_old;
  end if;
  perform set_config('app.settings_rename', 'off', true);
  return out;
end $$;

-- ---------- remove ----------
create or replace function public.admin_remove_list_item(p_tenant uuid, p_list text, p_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare cur jsonb; ix integer; n integer; out jsonb;
begin
  perform public._check_list_admin(p_tenant, p_list);
  cur := public._settings_list(p_tenant, p_list);
  if not cur ? p_name then raise exception '"%" not found', p_name; end if;

  if p_list = 'sales_stages' then
    select count(*) into n from public.task_templates where tenant_id = p_tenant and stage_system = 'sales' and stage = p_name;
    if n > 0 then raise exception '"%" still has % task template(s). Move or delete them first.', p_name, n; end if;
    select count(*) into n from public.trips where tenant_id = p_tenant and sales_stage = p_name;
    if n > 0 then raise exception '% trip(s) are in "%". Move them to another stage first.', n, p_name; end if;
  elsif p_list = 'trip_stages' then
    select (o - 1)::integer into ix from jsonb_array_elements_text(cur) with ordinality x(e, o) where e = p_name;
    if ix <> jsonb_array_length(cur) - 1 then raise exception 'Only the last trip stage can be removed'; end if;
    select count(*) into n from public.task_templates where tenant_id = p_tenant and stage_system = 'trip' and stage = p_name;
    if n > 0 then raise exception '"%" still has % task template(s). Move or delete them first.', p_name, n; end if;
    select count(*) into n from public.trips where tenant_id = p_tenant and trip_stage >= ix;
    if n > 0 then raise exception '% trip(s) have reached "%".', n, p_name; end if;
    select count(*) into n from public.tasks where tenant_id = p_tenant and gate >= ix;
    if n > 0 then raise exception '% task(s) are waiting for "%".', n, p_name; end if;
  elsif p_list = 'trip_types' then
    select count(*) into n from public.trips where tenant_id = p_tenant and trip_type = p_name;
    if n > 0 then raise exception '% trip(s) use "%".', n, p_name; end if;
    update public.task_templates set trip_types = array_remove(trip_types, p_name)
      where tenant_id = p_tenant and p_name = any (trip_types) and cardinality(trip_types) > 1;
    select count(*) into n from public.task_templates where tenant_id = p_tenant and trip_types = array[p_name];
    if n > 0 then raise exception '% template(s) apply only to "%". Change or delete them first.', n, p_name; end if;
  elsif p_list = 'task_types' then
    null;   -- free text on tasks; existing tasks keep their label
  end if;

  select coalesce(jsonb_agg(e order by o), '[]'::jsonb) into out
  from jsonb_array_elements_text(cur) with ordinality x(e, o) where e <> p_name;
  update public.tenants set settings = jsonb_set(settings, array[p_list], out, true) where id = p_tenant;
  return out;
end $$;

revoke execute on function public.admin_add_list_item(uuid, text, text, text)    from public, anon;
revoke execute on function public.admin_rename_list_item(uuid, text, text, text) from public, anon;
revoke execute on function public.admin_remove_list_item(uuid, text, text)       from public, anon;
grant  execute on function public.admin_add_list_item(uuid, text, text, text)    to authenticated;
grant  execute on function public.admin_rename_list_item(uuid, text, text, text) to authenticated;
grant  execute on function public.admin_remove_list_item(uuid, text, text)       to authenticated;

-- ---------- renames don't count as stage moves ----------
create or replace function public.log_trip_stage()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if current_setting('app.settings_rename', true) = 'on' then return new; end if;
  if tg_op = 'INSERT' or new.sales_stage is distinct from old.sales_stage then
    insert into public.trip_stage_events (tenant_id, trip_id, stage_system, from_value, to_value, actor_user_id)
    values (new.tenant_id, new.id, 'sales', case when tg_op = 'UPDATE' then old.sales_stage end, new.sales_stage, auth.uid());
  end if;
  if tg_op = 'UPDATE' and new.trip_stage is distinct from old.trip_stage then
    insert into public.trip_stage_events (tenant_id, trip_id, stage_system, from_value, to_value, actor_user_id)
    values (new.tenant_id, new.id, 'trip', old.trip_stage::text, new.trip_stage::text, auth.uid());
  end if;
  return new;
end $$;

create or replace function public.trips_apply_templates()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if current_setting('app.settings_rename', true) = 'on' then return new; end if;
  if tg_op = 'INSERT' then
    perform public.apply_task_templates(new.id, null);
  elsif new.sales_stage is distinct from old.sales_stage then
    perform public.apply_task_templates(new.id, 'sales');
  elsif new.trip_type is distinct from old.trip_type then
    perform public.apply_task_templates(new.id, null);
  end if;
  return new;
end $$;

create or replace function public.trip_stage_stamp()
returns trigger language plpgsql as $$
begin
  if current_setting('app.settings_rename', true) = 'on' then return new; end if;
  if tg_op = 'INSERT' then
    new.sales_stage_entered_at := now();
    new.trip_stage_entered_at  := now();
  else
    if new.sales_stage is distinct from old.sales_stage then new.sales_stage_entered_at := now(); end if;
    if new.trip_stage  is distinct from old.trip_stage  then new.trip_stage_entered_at  := now(); end if;
  end if;
  return new;
end $$;
