-- =============================================================================
-- EcoLogik Labs — 0009 Destinations: merge and delete
--   Destinations live in the tenant's settings.destinations list, and each trip keeps
--   its own picks in trips.details.destinations (staff can also type new ones on a
--   trip, so a misspelling can exist only on trips). Admins can now:
--     merge  : every trip with "from" gets "into" instead (no duplicates), and "from"
--              leaves the list. "into" is added to the list if it isn't there.
--     delete : the destination leaves the list AND every trip.
-- =============================================================================

-- Replace (or drop, when p_into is null) one destination on every trip of the tenant.
create or replace function public._replace_trip_destination(p_tenant uuid, p_from text, p_into text)
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  perform set_config('app.settings_rename', 'on', true);
  update public.trips t
     set details = jsonb_set(t.details, '{destinations}', coalesce((
           select jsonb_agg(v order by first_o) from (
             select v, min(o) as first_o
               from (select case when e = p_from then p_into else e end as v, o
                       from jsonb_array_elements_text(t.details -> 'destinations') with ordinality d(e, o)) x
              where v is not null
              group by v) y), '[]'::jsonb))
   where t.tenant_id = p_tenant
     and jsonb_typeof(t.details -> 'destinations') = 'array'
     and t.details -> 'destinations' ? p_from;
  get diagnostics n = row_count;
  perform set_config('app.settings_rename', 'off', true);
  return n;
end $$;
revoke execute on function public._replace_trip_destination(uuid, text, text) from public, anon, authenticated;

create or replace function public.admin_merge_destination(p_tenant uuid, p_from text, p_into text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare cur jsonb; into_name text := btrim(p_into); out jsonb; n integer;
begin
  perform public._check_list_admin(p_tenant, 'destinations');
  if p_from is null or btrim(p_from) = '' then raise exception 'Pick the destination to merge'; end if;
  if into_name is null or into_name = '' then raise exception 'Pick the destination to merge it into'; end if;
  if into_name = p_from then raise exception 'Pick a different destination to merge into'; end if;
  cur := public._settings_list(p_tenant, 'destinations');

  -- "into" takes "from"'s place in the list when it's new; "from" goes away.
  select coalesce(jsonb_agg(v order by o), '[]'::jsonb) into out from (
    select case when e = p_from and not cur ? into_name then into_name else e end as v, o
      from jsonb_array_elements_text(cur) with ordinality x(e, o)
     where not (e = p_from and cur ? into_name)) z;
  if not out ? into_name then out := out || to_jsonb(into_name); end if;
  update public.tenants set settings = jsonb_set(settings, '{destinations}', out, true) where id = p_tenant;

  n := public._replace_trip_destination(p_tenant, p_from, into_name);
  return jsonb_build_object('list', out, 'trips', n);
end $$;

create or replace function public.admin_delete_destination(p_tenant uuid, p_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare cur jsonb; out jsonb; n integer;
begin
  perform public._check_list_admin(p_tenant, 'destinations');
  if p_name is null or btrim(p_name) = '' then raise exception 'Pick the destination to delete'; end if;
  cur := public._settings_list(p_tenant, 'destinations');
  select coalesce(jsonb_agg(e order by o), '[]'::jsonb) into out
    from jsonb_array_elements_text(cur) with ordinality x(e, o) where e <> p_name;
  update public.tenants set settings = jsonb_set(settings, '{destinations}', out, true) where id = p_tenant;
  n := public._replace_trip_destination(p_tenant, p_name, null);
  return jsonb_build_object('list', out, 'trips', n);
end $$;

revoke execute on function public.admin_merge_destination(uuid, text, text) from public, anon;
revoke execute on function public.admin_delete_destination(uuid, text)      from public, anon;
grant  execute on function public.admin_merge_destination(uuid, text, text) to authenticated;
grant  execute on function public.admin_delete_destination(uuid, text)      to authenticated;
