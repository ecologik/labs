-- =============================================================================
-- EcoLogik Labs — 0005 Remove tasks from a trip
--   Template-made tasks are "removed" (dismissed_at set) rather than deleted, so
--   the template engine's one-per-trip rule still sees them and never re-adds a
--   task someone took off on purpose (e.g. when a trip re-enters a stage or
--   Heritage is re-ticked). Hand-added tasks are simply deleted by the app.
--   Removed tasks are hidden, never remind, and the removal is logged.
-- =============================================================================

alter table public.tasks add column dismissed_at timestamptz;
alter table public.tasks add column dismissed_by uuid references auth.users(id) on delete set null;
create index tasks_live_idx on public.tasks (tenant_id) where dismissed_at is null;

create or replace function public.task_dismiss_stamp()
returns trigger language plpgsql as $$
begin
  if new.dismissed_at is distinct from old.dismissed_at then
    new.dismissed_by := case when new.dismissed_at is null then null else auth.uid() end;
  end if;
  return new;
end $$;
create trigger tasks_dismiss_stamp before update on public.tasks
  for each row execute function public.task_dismiss_stamp();

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
    if new.dismissed_at is distinct from old.dismissed_at then
      insert into public.task_activity (tenant_id, task_id, actor_user_id, actor_member_id, action)
      values (new.tenant_id, new.id, actor, member, case when new.dismissed_at is null then 'restored' else 'removed' end);
    end if;
    if new.note is distinct from old.note then
      insert into public.task_activity (tenant_id, task_id, actor_user_id, actor_member_id, action, from_value, to_value)
      values (new.tenant_id, new.id, actor, member, 'note', left(old.note, 500), left(new.note, 500));
    end if;
  end if;
  return new;
end $$;


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
    and k.dismissed_at is null
    and k.due_date is not null
    and k.due_date - r.offset_days = p_date
    and (k.gate is null or tr.id is null or tr.trip_stage >= k.gate)
    and not exists (select 1 from public.reminder_sends s
                    where s.reminder_id = r.id and s.team_member_id = m.id and s.for_date = p_date)
$$;

revoke execute on function public.due_reminders(date) from public, anon, authenticated;
