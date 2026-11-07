-- Test fixture: the original DRAFT templates the engine tests were written against.
-- (Real Bella templates live in supabase/seed.templates.sql.)
with t as (select id from public.tenants where slug = 'bella'),
v(stage_system, stage, name, task_type, due_anchor, due_offset_days, pos) as (values
  -- Sales stages: created when the trip enters the stage. Due a few days after.
  ('sales','Proposal',      'Add proposal to Softrip',               'Creation',      'stage_entered', 3, 1),
  ('sales','Proposal',      'Create budget spreadsheet',             'Financial',     'stage_entered', 3, 2),
  ('sales','Proposal',      'Send proposal / budget to specialist',  'Internal',      'stage_entered', 5, 3),
  ('sales','Proposal',      'Send proposal to agent',                'Client-facing', 'stage_entered', 7, 4),
  ('sales','Proposal',      'Move Nutshell lead to Proposal',        'System Update', 'stage_entered', 1, 5),
  ('sales','In Creation',   'Build draft itinerary',                 'Creation',      'stage_entered', 7, 1),
  ('sales','In Creation',   'Add trip to Google Calendar',           'Internal',      'stage_entered', 2, 2),
  ('sales','In Creation',   'Create itinerary in Nivo',              'System Update', 'stage_entered', 7, 3),
  ('sales','In Creation',   'Assign MBV tour host',                  'Internal',      'stage_entered', 14, 4),
  ('sales','Client Review', 'Notify sales lead — trip in review',    'Internal',      'stage_entered', 1, 1),
  ('sales','Client Review', 'Confirm upfront fee paid',              'Financial',     'stage_entered', 7, 2),
  ('sales','Client Review', 'Confirm passport received',             'Client-facing', 'stage_entered', 14, 3),
  -- Trip stages: created up front, wait in the queue until the trip reaches the stage.
  ('trip','Book Trip',      'Confirm hotel bookings',                'Vendor',        'trip_start', -90, 1),
  ('trip','Book Trip',      'Arrange airport transfers',             'Vendor',        'trip_start', -60, 2),
  ('trip','45 days out',    'Invoice paid in full',                  'Financial',     'trip_start', -45, 1),
  ('trip','45 days out',    'Rooming list and passports collected',  'Vendor',        'trip_start', -40, 2),
  ('trip','45 days out',    'Flight information confirmed',          'Client-facing', 'trip_start', -40, 3),
  ('trip','45 days out',    'Final itinerary and Tella sent',        'Client-facing', 'trip_start', -30, 4),
  ('trip','45 days out',    'Welcome note and gift sent',            'Vendor',        'trip_start', -7,  5)
)
insert into public.task_templates (tenant_id, stage_system, stage, name, task_type, due_anchor, due_offset_days, position, reminder_offsets)
select t.id, v.stage_system, v.stage, v.name, v.task_type, v.due_anchor, v.due_offset_days, v.pos, '{1}'
from t, v
where not exists (select 1 from public.task_templates x
                  where x.tenant_id = t.id and x.stage_system = v.stage_system and x.stage = v.stage and x.name = v.name);

-- DRAFT Heritage tasks: added the moment a trip's Heritage box is ticked.
with t as (select id from public.tenants where slug = 'bella'),
v(name, task_type, due_anchor, due_offset_days, pos) as (values
  ('Create heritage research folder in Drive', 'Internal', 'stage_entered', 3,  1),
  ('Collect family names, towns and dates from client', 'Client-facing', 'stage_entered', 14, 2),
  ('Meeting held with heritage contact', 'Internal', 'trip_start', -30, 3)
)
insert into public.task_templates (tenant_id, stage_system, stage, name, task_type, due_anchor, due_offset_days, position, reminder_offsets)
select t.id, 'flag', 'heritage', v.name, v.task_type, v.due_anchor, v.due_offset_days, v.pos, '{1}'
from t, v
where not exists (select 1 from public.task_templates x
                  where x.tenant_id = t.id and x.stage_system = 'flag' and x.stage = 'heritage' and x.name = v.name);
