-- =============================================================================
-- EcoLogik Labs — 0004 Trip flags (e.g. Heritage) + task notes
--   * A third template "stage system": 'flag'. stage = the trip flag's key
--     (Bella: 'heritage'). Those tasks are added the moment the flag is switched
--     on for a trip (trips.details->>'heritage' = 'true'), or when a trip is
--     created with it on. Flag tasks are tagged with the flag (tasks.tags) so
--     the app can mark them. Unchecking the flag leaves existing tasks alone.
--   * Which flags a tenant offers lives in tenants.settings.trip_flags
--     ([{"key":"heritage","label":"Heritage"}]); the Core stays client-neutral.
--   * tasks.note: a free-text note anyone on staff can leave on a task
--     (e.g. when completing it). Who/when is stamped, and notes are logged.
-- =============================================================================

alter table public.task_templates drop constraint if exists task_templates_stage_system_check;
alter table public.task_templates add constraint task_templates_stage_system_check
  check (stage_system in ('sales','trip','flag'));

alter table public.tasks add column tags text[] not null default '{}';
alter table public.tasks add column note text;
alter table public.tasks add column note_updated_at timestamptz;
alter table public.tasks add column note_updated_by uuid references auth.users(id) on delete set null;

create or replace function public.task_note_stamp()
returns trigger language plpgsql as $$
begin
  if new.note is distinct from old.note then
    new.note := nullif(btrim(new.note), '');
    new.note_updated_at := now();
    new.note_updated_by := auth.uid();
  end if;
  return new;
end $$;
create trigger tasks_note_stamp before update on public.tasks
  for each row execute function public.task_note_stamp();

-- Log note changes in the task history too (keeps the 0001 behaviour for the rest).
create or replace function public.log_task_activity()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  member uuid := public.my_team_member(coalesce(new.tenant_id, old.tenant_id));
begin
  if tg_op = 'INSERT' then
    insert into public.task_activity (tenant_id, task_id, actor_user_id, actor_member_id, action, to_value)
    values (new.tenant_id, new.id, actor, member, 'created', new.status);
  elsif tg_op = 'UPDATE' then
    if new.status is distinct from old.status then
      insert into public.task_activity (tenant_id, task_id, actor_user_id, actor_member_id, action, from_value, to_value)
      values (new.tenant_id, new.id, actor, member, 'status', old.status, new.status);
    end if;
    if new.due_date is distinct from old.due_date then
      insert into public.task_activity (tenant_id, task_id, actor_user_id, actor_member_id, action, from_value, to_value)
      values (new.tenant_id, new.id, actor, member, 'due', old.due_date::text, new.due_date::text);
    end if;
    if new.name is distinct from old.name then
      insert into public.task_activity (tenant_id, task_id, actor_user_id, actor_member_id, action, from_value, to_value)
      values (new.tenant_id, new.id, actor, member, 'renamed', old.name, new.name);
    end if;
    if new.note is distinct from old.note then
      insert into public.task_activity (tenant_id, task_id, actor_user_id, actor_member_id, action, from_value, to_value)
      values (new.tenant_id, new.id, actor, member, 'note', left(old.note, 500), left(new.note, 500));
    end if;
  end if;
  return new;
end $$;

-- Template engine, now aware of flag templates.
create or replace function public.apply_task_templates(p_trip uuid, p_system text default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  tr        public.trips%rowtype;
  stages    jsonb;
  tpl       public.task_templates%rowtype;
  gate_ix   integer;
  new_task  uuid;
  due       date;
  who       uuid[];
  n         integer := 0;
begin
  select * into tr from public.trips where id = p_trip;
  if not found then return 0; end if;
  select settings->'trip_stages' into stages from public.tenants where id = tr.tenant_id;

  for tpl in
    select * from public.task_templates t
    where t.tenant_id = tr.tenant_id and t.active
      and (cardinality(t.trip_types) = 0 or tr.trip_type = any (t.trip_types))
      and (p_system is null or t.stage_system = p_system)
      and ((t.stage_system = 'sales' and t.stage = tr.sales_stage)
           or t.stage_system = 'trip'
           or (t.stage_system = 'flag' and tr.details ->> t.stage = 'true'))
      and not exists (select 1 from public.tasks k where k.trip_id = tr.id and k.template_id = t.id)
    order by case t.stage_system when 'sales' then 0 when 'flag' then 1 else 2 end, t.position, t.name
  loop
    gate_ix := null;
    if tpl.stage_system = 'trip' then
      select (e.ord - 1)::integer into gate_ix
      from jsonb_array_elements_text(coalesce(stages, '[]'::jsonb)) with ordinality e(val, ord)
      where e.val = tpl.stage;
      if gate_ix is null then continue; end if;   -- stage no longer in the tenant's list
    end if;

    due := case tpl.due_anchor
             when 'stage_entered' then current_date + coalesce(tpl.due_offset_days, 0)
             when 'trip_start'    then tr.start_date + coalesce(tpl.due_offset_days, 0)
             when 'trip_end'      then tr.end_date + coalesce(tpl.due_offset_days, 0)
           end;

    new_task := null;
    insert into public.tasks (tenant_id, trip_id, template_id, name, description, task_type, due_date, gate, tags)
    values (tr.tenant_id, tr.id, tpl.id, tpl.name, tpl.description, tpl.task_type, due,
            case when gate_ix is not null and gate_ix > 0 then gate_ix end,
            case when tpl.stage_system = 'flag' then array[tpl.stage] else '{}'::text[] end)
    on conflict do nothing
    returning id into new_task;
    if new_task is null then continue; end if;

    who := null;
    if tpl.default_role is not null then
      select array_agg(r.team_member_id) into who from public.trip_team_roles r
      where r.trip_id = tr.id and r.role = tpl.default_role;
    end if;
    if who is null and tpl.default_member_id is not null then who := array[tpl.default_member_id]; end if;
    if who is null and tr.lead_id is not null then who := array[tr.lead_id]; end if;
    if who is not null then
      insert into public.task_assignees (tenant_id, task_id, team_member_id)
      select tr.tenant_id, new_task, unnest(who) on conflict do nothing;
    end if;

    if cardinality(tpl.reminder_offsets) > 0 then
      insert into public.task_reminders (tenant_id, task_id, offset_days)
      select tr.tenant_id, new_task, o from unnest(tpl.reminder_offsets) o where o >= 0
      on conflict do nothing;
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

-- Fire flag templates when a trip's details change (e.g. Heritage ticked).
create or replace function public.trips_apply_templates()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if current_setting('app.settings_rename', true) = 'on' then return new; end if;
  if tg_op = 'INSERT' then
    perform public.apply_task_templates(new.id, null);
    return new;
  end if;
  if new.sales_stage is distinct from old.sales_stage then
    perform public.apply_task_templates(new.id, 'sales');
  end if;
  if new.details is distinct from old.details then
    perform public.apply_task_templates(new.id, 'flag');
  end if;
  if new.trip_type is distinct from old.trip_type then
    perform public.apply_task_templates(new.id, null);
  end if;
  return new;
end $$;
