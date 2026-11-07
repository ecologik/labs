-- =============================================================================
-- EcoLogik Labs — 0001 Foundation
--   Core layer only: tenants, accounts + roles, team roster, guides, trips, tasks.
--   Every table carries tenant_id and has RLS enabled in this same migration.
--   Child rows reference parents by (tenant_id, id), so a row can never point at
--   another tenant's record even if a policy were wrong.
--
--   Module tables (guide segments, gifts, Nivo itinerary, heritage folders) and
--   the tasks engine (reminders, templates) come in later migrations.
-- =============================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Shared helpers
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- -----------------------------------------------------------------------------
-- Tenants
--   modules  : on/off flags per optional module (gifts, guide_schedule, nivo,
--              heritage, guide_note). Core never reads a module's tables
--              unless its flag is on.
--   settings : per-tenant lists the Core needs (stage lists, trip types,
--              task types). Phase 2 adds the admin UI to edit them.
-- -----------------------------------------------------------------------------
create table public.tenants (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name        text not null,
  modules     jsonb not null default '{}'::jsonb,
  settings    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger tenants_updated before update on public.tenants
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Team roster (office staff) and guides (field guides; may overlap with team)
-- -----------------------------------------------------------------------------
create table public.team_members (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  name        text not null,
  role_title  text,
  email       text,
  color       text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, id)
);
create unique index team_members_email_uq on public.team_members (tenant_id, lower(email)) where email is not null;
create trigger team_members_updated before update on public.team_members
  for each row execute function public.set_updated_at();

create table public.guides (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  name            text not null,
  color           text,
  email           text,
  team_member_id  uuid,               -- set when the guide is also on the office team (e.g. Peppe)
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, team_member_id) references public.team_members (tenant_id, id) on delete set null (team_member_id)
);
create trigger guides_updated before update on public.guides
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Accounts: a login (auth.users) belongs to a tenant with exactly one role.
--   staff : full access to the tenant's data
--   admin : staff + accounts and settings
--   guide : read-only, Calendar + Heritage only (granted by module migrations)
-- -----------------------------------------------------------------------------
create table public.memberships (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  role            text not null check (role in ('staff','admin','guide')),
  team_member_id  uuid,
  guide_id        uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (tenant_id, user_id),
  foreign key (tenant_id, team_member_id) references public.team_members (tenant_id, id) on delete set null (team_member_id),
  foreign key (tenant_id, guide_id)       references public.guides (tenant_id, id)       on delete set null (guide_id),
  check (role <> 'guide' or guide_id is not null)
);
create index memberships_user_idx on public.memberships (user_id);
create trigger memberships_updated before update on public.memberships
  for each row execute function public.set_updated_at();

-- Invitations: an admin (or the seed) invites an email with a role. When that
-- person first signs in with Google, the invitation turns into a membership.
create table public.invitations (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  email           text not null,
  role            text not null check (role in ('staff','admin','guide')),
  team_member_id  uuid,
  guide_id        uuid,
  invited_by      uuid references auth.users(id) on delete set null,
  accepted_at     timestamptz,
  created_at      timestamptz not null default now(),
  foreign key (tenant_id, team_member_id) references public.team_members (tenant_id, id) on delete cascade,
  foreign key (tenant_id, guide_id)       references public.guides (tenant_id, id)       on delete cascade,
  check (role <> 'guide' or guide_id is not null)
);
create unique index invitations_open_uq on public.invitations (tenant_id, lower(email)) where accepted_at is null;

-- -----------------------------------------------------------------------------
-- Role helpers for RLS. SECURITY DEFINER so policies on memberships don't
-- recurse; search_path pinned so they can't be hijacked.
-- -----------------------------------------------------------------------------
create or replace function public.my_role(t uuid)
returns text language sql stable security definer set search_path = '' as $$
  select m.role from public.memberships m
  where m.tenant_id = t and m.user_id = auth.uid()
$$;

create or replace function public.is_member(t uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.memberships m where m.tenant_id = t and m.user_id = auth.uid())
$$;

create or replace function public.is_staff(t uuid)   -- staff or admin
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.memberships m
                 where m.tenant_id = t and m.user_id = auth.uid() and m.role in ('staff','admin'))
$$;

create or replace function public.is_admin(t uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.memberships m
                 where m.tenant_id = t and m.user_id = auth.uid() and m.role = 'admin')
$$;

-- The calling user's team_member id in a tenant (used for task activity "actor").
create or replace function public.my_team_member(t uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select m.team_member_id from public.memberships m
  where m.tenant_id = t and m.user_id = auth.uid()
$$;

-- Turn open invitations for a user's email into memberships.
create or replace function public.accept_invitations_for(p_user uuid, p_email text)
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if p_email is null then return 0; end if;
  with inv as (
    update public.invitations i set accepted_at = now()
    where lower(i.email) = lower(p_email) and i.accepted_at is null
    returning i.tenant_id, i.role, i.team_member_id, i.guide_id
  )
  insert into public.memberships (tenant_id, user_id, role, team_member_id, guide_id)
  select tenant_id, p_user, role, team_member_id, guide_id from inv
  on conflict (tenant_id, user_id) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.accept_invitations_for(uuid, text) from public;

-- On first sign-in (new auth.users row) claim invitations automatically.
create or replace function public.on_auth_user_created()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.accept_invitations_for(new.id, new.email);
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.on_auth_user_created();

-- For users who already existed before they were invited: callable from the app.
create or replace function public.claim_invitations()
returns integer language sql security definer set search_path = '' as $$
  select public.accept_invitations_for(
    auth.uid(),
    (select u.email from auth.users u where u.id = auth.uid())
  )
$$;

-- -----------------------------------------------------------------------------
-- Trips (Core). Travel-specific extras live in `details` jsonb so the Core
-- stays client-neutral. Sources upsert idempotently on (tenant, source, ref).
--   sales_stage : sales pipeline (Bella: Proposal → In Creation → Client Review → Booked)
--   trip_stage  : index into the tenant's trip-stage list (Bella: Paid Deposit → … → Arrived)
-- -----------------------------------------------------------------------------
create table public.trips (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  name            text not null,
  trip_type       text,
  sales_stage     text,
  trip_stage      integer not null default 0 check (trip_stage >= 0),
  start_date      date,
  end_date        date,
  lead_id         uuid,
  details         jsonb not null default '{}'::jsonb,
  source          text not null default 'manual',
  external_ref    text,
  archived        boolean not null default false,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, lead_id) references public.team_members (tenant_id, id) on delete set null (lead_id),
  check (end_date is null or start_date is null or end_date >= start_date)
);
create unique index trips_source_ref_uq on public.trips (tenant_id, source, external_ref) where external_ref is not null;
create index trips_tenant_start_idx on public.trips (tenant_id, start_date);
create trigger trips_updated before update on public.trips
  for each row execute function public.set_updated_at();

-- The several capacities a team member plays on a trip (sales lead, specialist, operations, tour host).
create table public.trip_team_roles (
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  trip_id         uuid not null,
  team_member_id  uuid not null,
  role            text not null,
  primary key (trip_id, team_member_id, role),
  foreign key (tenant_id, trip_id)        references public.trips (tenant_id, id)        on delete cascade,
  foreign key (tenant_id, team_member_id) references public.team_members (tenant_id, id) on delete cascade
);

-- -----------------------------------------------------------------------------
-- Tasks (Core)
--   gate : trip_stage index at which the task becomes active (staged queue).
--          null = always active.
-- -----------------------------------------------------------------------------
create table public.tasks (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  trip_id       uuid,
  name          text not null,
  description   text,
  task_type     text,
  status        text not null default 'Not Started'
                check (status in ('Not Started','In Progress','Waiting on Client','Complete')),
  due_date      date,
  gate          integer check (gate is null or gate >= 0),
  created_by    uuid references auth.users(id) on delete set null,
  completed_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, trip_id) references public.trips (tenant_id, id) on delete cascade
);
create index tasks_tenant_due_idx on public.tasks (tenant_id, due_date);
create index tasks_trip_idx on public.tasks (trip_id);
create trigger tasks_updated before update on public.tasks
  for each row execute function public.set_updated_at();

create table public.task_assignees (
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  task_id         uuid not null,
  team_member_id  uuid not null,
  primary key (task_id, team_member_id),
  foreign key (tenant_id, task_id)        references public.tasks (tenant_id, id)        on delete cascade,
  foreign key (tenant_id, team_member_id) references public.team_members (tenant_id, id) on delete cascade
);
create index task_assignees_member_idx on public.task_assignees (team_member_id);

-- Append-only audit log ("moved by …" + history). Written only by triggers.
create table public.task_activity (
  id               bigint generated always as identity primary key,
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  task_id          uuid not null,
  actor_user_id    uuid references auth.users(id) on delete set null,
  actor_member_id  uuid,
  action           text not null,             -- created | status | due | renamed | deleted
  from_value       text,
  to_value         text,
  at               timestamptz not null default now(),
  foreign key (tenant_id, task_id) references public.tasks (tenant_id, id) on delete cascade
);
create index task_activity_task_idx on public.task_activity (task_id, at desc);

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
  end if;
  return new;
end $$;
create trigger tasks_activity after insert or update on public.tasks
  for each row execute function public.log_task_activity();

-- Keep completed_at in step with status.
create or replace function public.task_completed_at()
returns trigger language plpgsql as $$
begin
  if new.status = 'Complete' and (tg_op = 'INSERT' or old.status is distinct from 'Complete') then
    new.completed_at := now();
  elsif new.status <> 'Complete' then
    new.completed_at := null;
  end if;
  return new;
end $$;
create trigger tasks_completed_at before insert or update on public.tasks
  for each row execute function public.task_completed_at();

-- tenant_id on a child must never change after insert.
create or replace function public.freeze_tenant_id()
returns trigger language plpgsql as $$
begin
  if new.tenant_id is distinct from old.tenant_id then
    raise exception 'tenant_id cannot be changed';
  end if;
  return new;
end $$;
create trigger team_members_freeze  before update on public.team_members  for each row execute function public.freeze_tenant_id();
create trigger guides_freeze        before update on public.guides        for each row execute function public.freeze_tenant_id();
create trigger memberships_freeze   before update on public.memberships   for each row execute function public.freeze_tenant_id();
create trigger trips_freeze         before update on public.trips         for each row execute function public.freeze_tenant_id();
create trigger tasks_freeze         before update on public.tasks         for each row execute function public.freeze_tenant_id();

-- =============================================================================
-- Row-Level Security
-- =============================================================================
alter table public.tenants          enable row level security;
alter table public.team_members     enable row level security;
alter table public.guides           enable row level security;
alter table public.memberships      enable row level security;
alter table public.invitations      enable row level security;
alter table public.trips            enable row level security;
alter table public.trip_team_roles  enable row level security;
alter table public.tasks            enable row level security;
alter table public.task_assignees   enable row level security;
alter table public.task_activity    enable row level security;

-- Tenants: members read their tenant; admins update settings/modules.
create policy tenants_read  on public.tenants for select to authenticated using (public.is_member(id));
create policy tenants_admin on public.tenants for update to authenticated using (public.is_admin(id)) with check (public.is_admin(id));

-- Team roster: staff read; admins manage.
create policy team_read  on public.team_members for select to authenticated using (public.is_staff(tenant_id));
create policy team_admin on public.team_members for all    to authenticated using (public.is_admin(tenant_id)) with check (public.is_admin(tenant_id));

-- Guides: every member reads (guides need names/colours for the Calendar); admins manage.
create policy guides_read  on public.guides for select to authenticated using (public.is_member(tenant_id));
create policy guides_admin on public.guides for all    to authenticated using (public.is_admin(tenant_id)) with check (public.is_admin(tenant_id));

-- Memberships: you see your own; admins see and manage the tenant's.
create policy memberships_self  on public.memberships for select to authenticated using (user_id = auth.uid());
create policy memberships_admin on public.memberships for all    to authenticated using (public.is_admin(tenant_id)) with check (public.is_admin(tenant_id));

-- Invitations: admins only.
create policy invitations_admin on public.invitations for all to authenticated using (public.is_admin(tenant_id)) with check (public.is_admin(tenant_id));

-- Trips / tasks: staff (and admins) have full access. Guides get NO access here;
-- the guide-schedule module migration grants them the narrow slice they need.
create policy trips_staff       on public.trips           for all to authenticated using (public.is_staff(tenant_id)) with check (public.is_staff(tenant_id));
create policy trip_roles_staff  on public.trip_team_roles for all to authenticated using (public.is_staff(tenant_id)) with check (public.is_staff(tenant_id));
create policy tasks_staff       on public.tasks           for all to authenticated using (public.is_staff(tenant_id)) with check (public.is_staff(tenant_id));
create policy assignees_staff   on public.task_assignees  for all to authenticated using (public.is_staff(tenant_id)) with check (public.is_staff(tenant_id));
-- Activity is read-only to staff; rows come from the trigger only.
create policy activity_read     on public.task_activity   for select to authenticated using (public.is_staff(tenant_id));

-- =============================================================================
-- Grants: anon gets nothing; authenticated gets table privileges (RLS decides rows).
-- =============================================================================
revoke all on public.tenants, public.team_members, public.guides, public.memberships, public.invitations,
              public.trips, public.trip_team_roles, public.tasks, public.task_assignees, public.task_activity
  from anon;
grant select, update                 on public.tenants to authenticated;
grant select, insert, update, delete on public.team_members, public.guides, public.memberships, public.invitations,
                                        public.trips, public.trip_team_roles, public.tasks, public.task_assignees
  to authenticated;
grant select                         on public.task_activity to authenticated;

revoke execute on function public.claim_invitations() from public, anon;
grant  execute on function public.claim_invitations() to authenticated;
