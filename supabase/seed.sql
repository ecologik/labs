-- =============================================================================
-- Seed: Bella (My Bella Vita Dash) as tenant #1 — config + roster only.
-- Safe to run more than once. Contains NO personal emails (this repo is public);
-- add invitations by hand at the bottom, in the Supabase SQL editor.
-- =============================================================================

insert into public.tenants (slug, name, modules, settings) values (
  'bella',
  'My Bella Vita Travel',
  '{"gifts":true,"guide_schedule":true,"nivo":true,"heritage":true,"guide_note":true}',
  '{
     "sales_stages": ["Proposal","In Creation","Client Review","Booked"],
     "trip_stages":  ["Paid Deposit","Book Trip","45 days out","Arrived"],
     "trip_types":   ["B2B","Custom/Private","Small Group"],
     "task_types":   ["Client-facing","Vendor","Internal","Financial","Creation","System Update"],
     "trip_team_roles": ["Sales lead","Travel specialist","Operations","Tour host"],
     "destinations": ["Rome","Florence","Venice","Milan","Lakes (other)","Piemonte","Tuscany","Amalfi Coast","Sorrento","Puglia","Calabria","Sicily","Sardinia","Malta","Naples","Cinque Terre","Como","Bologna Area","Central Europe"]
   }'
) on conflict (slug) do update set modules = excluded.modules, settings = excluded.settings;

with t as (select id from public.tenants where slug = 'bella')
insert into public.team_members (tenant_id, name, role_title, color)
select t.id, v.name, v.role_title, v.color from t, (values
  ('Cherrye Moore',     'Owner / Sales Lead', '#9c3d54'),
  ('Gianluca Muzzillo', 'Travel Specialist',  '#2a78d6'),
  ('Peppe Mannella',    'Operations',         '#1baf7a'),
  ('Lulu Bianco',       'Marketing & CRM',    '#d1699a'),
  ('Cole',              'Admin Assistant',    '#5a4bb0')
) as v(name, role_title, color)
where not exists (select 1 from public.team_members m where m.tenant_id = t.id and m.name = v.name);

-- Field guides (deduped from the Airtable Team Members rows 6–12). Peppe is both.
with t as (select id from public.tenants where slug = 'bella')
insert into public.guides (tenant_id, name, color, team_member_id)
select t.id, v.name, v.color,
       (select m.id from public.team_members m where m.tenant_id = t.id and m.name = v.name)
from t, (values
  ('Peppe Mannella', '#1baf7a'),
  ('Domenico Boi',   '#c26b2a'),
  ('Mimmo Passero',  '#7a6cd0'),
  ('Pietro Mercuri', '#2a9d9d'),
  ('Jesse Ritrovato','#b0803a')
) as v(name, color)
where not exists (select 1 from public.guides g where g.tenant_id = t.id and g.name = v.name);

-- -----------------------------------------------------------------------------
-- Invitations — run by hand with real emails. On first Google sign-in each one
-- becomes a login with that role. Example:
--
-- insert into public.invitations (tenant_id, email, role, team_member_id)
-- select t.id, 'someone@example.com', 'admin', m.id
-- from public.tenants t join public.team_members m on m.tenant_id = t.id
-- where t.slug = 'bella' and m.name = 'Cherrye Moore';
--
-- A guide login must point at a guide row:
-- insert into public.invitations (tenant_id, email, role, guide_id)
-- select t.id, 'guide@example.com', 'guide', g.id
-- from public.tenants t join public.guides g on g.tenant_id = t.id
-- where t.slug = 'bella' and g.name = 'Domenico Boi';
-- -----------------------------------------------------------------------------

-- Trip flags Bella uses (checkboxes on a trip that can trigger their own tasks).
update public.tenants
set settings = jsonb_set(settings, '{trip_flags}', '[{"key":"heritage","label":"Heritage"}]'::jsonb, true)
where slug = 'bella' and not (settings ? 'trip_flags');
