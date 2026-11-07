-- =============================================================================
-- EcoLogik Labs — 0010 Phone numbers for the team and guides
--   Free text (people often have two: "+1 409 … / +39 388 …"). Shown on the Guide Note.
--   Admins already manage both tables (RLS from 0001); staff read the team, every
--   member reads guides.
-- =============================================================================
alter table public.team_members add column if not exists phone text;
alter table public.guides       add column if not exists phone text;

do $$ begin
  alter table public.team_members add constraint team_members_phone_len check (phone is null or length(phone) <= 80);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.guides add constraint guides_phone_len check (phone is null or length(phone) <= 80);
exception when duplicate_object then null; end $$;
