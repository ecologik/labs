-- =============================================================================
-- EcoLogik Labs — 0006 Trip details
--   The "Edit trip details" drawer keeps a trip's intake fields in trips.details
--   (jsonb, tenant-specific), alongside the core columns (name, type, dates, lead):
--     tour_name, pax_min, pax_max, destinations[], tour_leader_id (a guide),
--     notes, links{client_file,nivo,budget}, heritage_folder{url,name},
--     gift{kind,location,rooms,note}
--   The destination picker offers the tenant's settings.destinations list, which
--   admins can now manage like the other lists.
-- =============================================================================

create or replace function public._check_list_admin(p_tenant uuid, p_list text)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin(p_tenant) then raise exception 'Only admins can change settings' using errcode = '42501'; end if;
  if p_list not in ('sales_stages','trip_stages','trip_types','task_types','destinations') then
    raise exception 'Unknown list %', p_list;
  end if;
end $$;
revoke execute on function public._check_list_admin(uuid, text) from public, anon, authenticated;

-- Renaming a destination renames it on every trip too. (Removing one leaves trips as they are.)
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
  elsif p_list = 'destinations' then
    update public.trips
      set details = jsonb_set(details, '{destinations}',
        (select jsonb_agg(case when e = p_old then new_name else e end order by o)
         from jsonb_array_elements_text(details -> 'destinations') with ordinality d(e, o)))
      where tenant_id = p_tenant and jsonb_typeof(details -> 'destinations') = 'array' and details -> 'destinations' ? p_old;
  end if;
  perform set_config('app.settings_rename', 'off', true);
  return out;
end $$;
