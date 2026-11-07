-- =============================================================================
-- EcoLogik Labs — 0007 Guide schedule (module: guide_schedule)
--   Segments of a trip's days: guided by a guide, or "on their own" (no guide).
--   Shown as a drag/resize timeline on the trip page, and later on the Calendar.
--   Staff manage them. Guide logins get read access in the Calendar step.
-- =============================================================================

create table public.trip_segments (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  trip_id     uuid not null,
  label       text not null check (btrim(label) <> ''),
  start_date  date not null,
  end_date    date not null,
  guide_id    uuid,
  note        text,
  created_by  uuid references auth.users(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, trip_id)  references public.trips (tenant_id, id)  on delete cascade,
  foreign key (tenant_id, guide_id) references public.guides (tenant_id, id) on delete set null (guide_id),
  check (end_date >= start_date)
);
create index trip_segments_trip_idx  on public.trip_segments (trip_id, start_date);
create index trip_segments_guide_idx on public.trip_segments (tenant_id, guide_id, start_date);
create trigger trip_segments_updated before update on public.trip_segments
  for each row execute function public.set_updated_at();
create trigger trip_segments_freeze  before update on public.trip_segments
  for each row execute function public.freeze_tenant_id();

alter table public.trip_segments enable row level security;
create policy segments_staff on public.trip_segments for all to authenticated
  using (public.is_staff(tenant_id)) with check (public.is_staff(tenant_id));

revoke all on public.trip_segments from anon;
grant select, insert, update, delete on public.trip_segments to authenticated;
