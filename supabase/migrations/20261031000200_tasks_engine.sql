-- =============================================================================
-- EcoLogik Labs — 0002 Tasks engine (database side)
--   * trip_stage_events : history of both stage systems (who moved what, when)
--   * task_templates    : checklists keyed on (stage_system, stage, trip_type)
--   * apply_task_templates(): generates tasks when a trip is created or
--     enters a sales stage. Trip-stage templates are created up front as
--     gated tasks, so they wait in the queue until the trip reaches that stage.
--   * task_reminders (+ recipients, + sends log) and due_reminders(date) for
--     the daily reminder-email job.
-- Same rules as 0001: tenant_id + RLS everywhere, composite tenant FKs.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Stage history
-- -----------------------------------------------------------------------------
alter table public.trips add column sales_stage_entered_at timestamptz;
alter table public.trips add column trip_stage_entered_at  timestamptz;
update public.trips set sales_stage_entered_at = coalesce(sales_stage_entered_at, created_at),
                        trip_stage_entered_at  = coalesce(trip_stage_entered_at,  created_at);

create table public.trip_stage_events (
  id             bigint generated always as identity primary key,
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  trip_id        uuid not null,
  stage_system   text not null check (stage_system in ('sales','trip')),
  from_value     text,
  to_value       text,
  actor_user_id  uuid references auth.users(id) on delete set null,
  at             timestamptz not null default now(),
  foreign key (tenant_id, trip_id) references public.trips (tenant_id, id) on delete cascade
);
create index trip_stage_events_trip_idx on public.trip_stage_events (trip_id, at desc);

create or replace function public.trip_stage_stamp()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.sales_stage_entered_at := now();
    new.trip_stage_entered_at  := now();
  else
    if new.sales_stage is distinct from old.sales_stage then new.sales_stage_entered_at := now(); end if;
    if new.trip_stage  is distinct from old.trip_stage  then new.trip_stage_entered_at  := now(); end if;
  end if;
  return new;
end $$;
create trigger trips_stage_stamp before insert or update on public.trips
  for each row execute function public.trip_stage_stamp();

create or replace function public.log_trip_stage()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
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
create trigger trips_stage_log after insert or update on public.trips
  for each row execute function public.log_trip_stage();

-- -----------------------------------------------------------------------------
-- Task templates
--   stage_system = 'sales' : stage is a sales-stage name; tasks are created when
--                            the trip enters that stage (or is created in it).
--   stage_system = 'trip'  : stage is a trip-stage name; tasks are created when the
--                            trip is created, gated to that stage's index.
--   trip_types   : which trip types get it; empty = all types.
--   Assignee: members holding default_role on the trip, else default_member_id,
--             else the trip lead.
--   Due date: due_anchor + due_offset_days ('stage_entered' = the day the task is
--             generated/released, 'trip_start', 'trip_end'); null anchor = no date.
-- -----------------------------------------------------------------------------
create table public.task_templates (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  stage_system       text not null check (stage_system in ('sales','trip')),
  stage              text not null,
  trip_types         text[] not null default '{}',
  name               text not null,
  description        text,
  task_type          text,
  default_role       text,
  default_member_id  uuid,
  due_anchor         text check (due_anchor in ('stage_entered','trip_start','trip_end')),
  due_offset_days    integer,
  reminder_offsets   integer[] not null default '{}',   -- days before due; recipients = assignees
  position           integer not null default 0,
  active             boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, default_member_id) references public.team_members (tenant_id, id) on delete set null (default_member_id)
);
create index task_templates_lookup_idx on public.task_templates (tenant_id, stage_system, stage) where active;
create trigger task_templates_updated before update on public.task_templates
  for each row execute function public.set_updated_at();
create trigger task_templates_freeze before update on public.task_templates
  for each row execute function public.freeze_tenant_id();

alter table public.tasks add column template_id uuid;
alter table public.tasks add constraint tasks_template_fk
  foreign key (tenant_id, template_id) references public.task_templates (tenant_id, id) on delete set null (template_id);
-- One generated task per template per trip, so re-entering a stage never duplicates.
create unique index tasks_trip_template_uq on public.tasks (trip_id, template_id) where template_id is not null;

-- -----------------------------------------------------------------------------
-- Reminders
-- -----------------------------------------------------------------------------
create table public.task_reminders (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  task_id      uuid not null,
  offset_days  integer not null check (offset_days >= 0),   -- days before the due date (0 = on the day)
  created_at   timestamptz not null default now(),
  unique (tenant_id, id),
  unique (task_id, offset_days),
  foreign key (tenant_id, task_id) references public.tasks (tenant_id, id) on delete cascade
);

-- Who a reminder goes to. No rows = all of the task's assignees.
create table public.task_reminder_recipients (
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  reminder_id     uuid not null,
  team_member_id  uuid not null,
  primary key (reminder_id, team_member_id),
  foreign key (tenant_id, reminder_id)    references public.task_reminders (tenant_id, id) on delete cascade,
  foreign key (tenant_id, team_member_id) references public.team_members (tenant_id, id)  on delete cascade
);

-- One row per email actually sent; makes the daily job safe to re-run.
create table public.reminder_sends (
  id              bigint generated always as identity primary key,
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  reminder_id     uuid not null,
  team_member_id  uuid not null,
  for_date        date not null,
  sent_at         timestamptz not null default now(),
  unique (reminder_id, team_member_id, for_date),
  foreign key (tenant_id, reminder_id)    references public.task_reminders (tenant_id, id) on delete cascade,
  foreign key (tenant_id, team_member_id) references public.team_members (tenant_id, id)  on delete cascade
);

-- Everything the reminder job should send on a given day (not yet sent, task not
-- complete, task not still queued, recipient has an email). Service role only.
create or replace function public.due_reminders(p_date date default current_date)
returns table (reminder_id uuid, tenant_id uuid, tenant_name text, task_id uuid, task_name text,
               due_date date, offset_days integer, trip_id uuid, trip_name text,
               team_member_id uuid, member_name text, member_email text)
language sql stable security definer set search_path = '' as $$
  select r.id, r.tenant_id, tn.name, k.id, k.name, k.due_date, r.offset_days, tr.id, tr.name,
         m.id, m.name, m.email
  from public.task_reminders r
  join public.tasks k    on k.id = r.task_id
  join public.tenants tn on tn.id = r.tenant_id
  left join public.trips tr on tr.id = k.trip_id
  join lateral (
    select rr.team_member_id from public.task_reminder_recipients rr where rr.reminder_id = r.id
    union
    select a.team_member_id from public.task_assignees a
    where a.task_id = k.id and not exists (select 1 from public.task_reminder_recipients rr2 where rr2.reminder_id = r.id)
  ) who on true
  join public.team_members m on m.id = who.team_member_id and m.active and m.email is not null
  where k.status <> 'Complete'
    and k.due_date is not null
    and k.due_date - r.offset_days = p_date
    and (k.gate is null or tr.id is null or tr.trip_stage >= k.gate)
    and not exists (select 1 from public.reminder_sends s
                    where s.reminder_id = r.id and s.team_member_id = m.id and s.for_date = p_date)
$$;
revoke execute on function public.due_reminders(date) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Template engine
-- -----------------------------------------------------------------------------
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
      and ((t.stage_system = 'sales' and t.stage = tr.sales_stage) or t.stage_system = 'trip')
      and not exists (select 1 from public.tasks k where k.trip_id = tr.id and k.template_id = t.id)
    order by t.stage_system, t.position, t.name
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
    insert into public.tasks (tenant_id, trip_id, template_id, name, description, task_type, due_date, gate)
    values (tr.tenant_id, tr.id, tpl.id, tpl.name, tpl.description, tpl.task_type, due,
            case when gate_ix is not null and gate_ix > 0 then gate_ix end)
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
revoke execute on function public.apply_task_templates(uuid, text) from public, anon, authenticated;

create or replace function public.trips_apply_templates()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform public.apply_task_templates(new.id, null);
  elsif new.sales_stage is distinct from old.sales_stage then
    perform public.apply_task_templates(new.id, 'sales');
  elsif new.trip_type is distinct from old.trip_type then
    perform public.apply_task_templates(new.id, null);
  end if;
  return new;
end $$;
create trigger trips_templates after insert or update on public.trips
  for each row execute function public.trips_apply_templates();

-- Staff can re-run templates for a trip they can see (e.g. after editing templates).
create or replace function public.regenerate_trip_tasks(p_trip uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare t uuid;
begin
  select tenant_id into t from public.trips where id = p_trip;
  if t is null or not public.is_staff(t) then raise exception 'not allowed'; end if;
  return public.apply_task_templates(p_trip, null);
end $$;
revoke execute on function public.regenerate_trip_tasks(uuid) from public, anon;
grant  execute on function public.regenerate_trip_tasks(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.trip_stage_events        enable row level security;
alter table public.task_templates           enable row level security;
alter table public.task_reminders           enable row level security;
alter table public.task_reminder_recipients enable row level security;
alter table public.reminder_sends           enable row level security;

create policy stage_events_read   on public.trip_stage_events        for select to authenticated using (public.is_staff(tenant_id));
create policy templates_read      on public.task_templates           for select to authenticated using (public.is_staff(tenant_id));
create policy templates_admin     on public.task_templates           for all    to authenticated using (public.is_admin(tenant_id)) with check (public.is_admin(tenant_id));
create policy reminders_staff     on public.task_reminders           for all    to authenticated using (public.is_staff(tenant_id)) with check (public.is_staff(tenant_id));
create policy recipients_staff    on public.task_reminder_recipients for all    to authenticated using (public.is_staff(tenant_id)) with check (public.is_staff(tenant_id));
create policy sends_read          on public.reminder_sends           for select to authenticated using (public.is_staff(tenant_id));

revoke all on public.trip_stage_events, public.task_templates, public.task_reminders,
              public.task_reminder_recipients, public.reminder_sends from anon;
grant select                         on public.trip_stage_events, public.reminder_sends to authenticated;
grant select, insert, update, delete on public.task_templates, public.task_reminders, public.task_reminder_recipients to authenticated;
