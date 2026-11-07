-- =============================================================================
-- Bella task templates, built from Cherrye's Airtable "Tasks by Trip" and
-- "Heritage Tasks" views (2026-11-07). One set per trip type, plus Heritage.
--   * Sales-stage tasks are added when a trip enters the stage; due N days later.
--   * Itinerary / Briefs / Pre-Departure / Post-Trip tasks are added at Booked and
--     are due relative to the travel dates (e.g. "-8w depart" = 56 days before start).
--   * "per Nivo ..." rules have no due date; set it by hand on the trip.
-- Replaces the earlier DRAFT templates (tasks already on trips are kept).
-- Safe to re-run.
-- =============================================================================

-- Sales stages Airtable uses, in pipeline order; any others already set are kept at the end.
update public.tenants t
set settings = jsonb_set(t.settings, '{sales_stages}',
  (select jsonb_agg(s order by o) from (
     select s, o from unnest(array['Inquiry', 'Proposal', 'In Creation', 'Awaiting Client', 'Client Review', 'Booked', 'Confirmed', 'Fully Booked', 'Postponed', 'Returned', 'Complete']::text[]) with ordinality a(s, o)
     union all
     select e.s, 100 + e.o from jsonb_array_elements_text(coalesce(t.settings->'sales_stages', '[]')) with ordinality e(s, o)
     where e.s <> all (array['Inquiry', 'Proposal', 'In Creation', 'Awaiting Client', 'Client Review', 'Booked', 'Confirmed', 'Fully Booked', 'Postponed', 'Returned', 'Complete']::text[])
  ) x))
where t.slug = 'bella';

-- Retire the DRAFT templates from the first build.
delete from public.task_templates x using public.tenants t
where x.tenant_id = t.id and t.slug = 'bella'
  and x.description is null
  and x.name = any (array['Add proposal to Softrip', 'Create budget spreadsheet', 'Send proposal / budget to specialist', 'Send proposal to agent', 'Move Nutshell lead to Proposal', 'Build draft itinerary', 'Add trip to Google Calendar', 'Create itinerary in Nivo', 'Assign MBV tour host', 'Notify sales lead — trip in review', 'Confirm upfront fee paid', 'Confirm passport received', 'Confirm hotel bookings', 'Arrange airport transfers', 'Invoice paid in full', 'Rooming list and passports collected', 'Flight information confirmed', 'Final itinerary and Tella sent', 'Welcome note and gift sent', 'Create heritage research folder in Drive', 'Collect family names, towns and dates from client', 'Meeting held with heritage contact']);

with t as (select id from public.tenants where slug = 'bella'),
v(stage_system, stage, trip_types, name, description, task_type, member, due_anchor, due_offset_days, pos, active) as (values
  ('sales','Inquiry',array['Custom/Private']::text[],'Notify Cherrye — new trip file created','From Airtable (Sales / Outline, due “+0d stage”).','Internal','Cole','stage_entered',0,0,true),
  ('sales','Inquiry',array['Custom/Private']::text[],'Upfront fee paid — move lead to "Upfront Fee Paid" in Nutshell','From Airtable (Sales / Outline, due “+1d stage”).','System Update','Cole','stage_entered',1,1,true),
  ('sales','Proposal',array['Custom/Private']::text[],'Send intro email to client','From Airtable (Proposal, due “+1d stage”).','Client-facing','Gianluca Muzzillo','stage_entered',1,0,true),
  ('sales','Proposal',array['Custom/Private']::text[],'Add trip to shared Google Calendar','From Airtable (Proposal, due “+2d stage”).','System Update','Gianluca Muzzillo','stage_entered',2,1,true),
  ('sales','Proposal',array['Custom/Private']::text[],'Create budget spreadsheet','From Airtable (Proposal, due “+2d stage”).','Creation','Gianluca Muzzillo','stage_entered',2,2,true),
  ('sales','Proposal',array['Custom/Private']::text[],'Send budget to Peppe for review','From Airtable (Proposal, due “+3d stage”).','Internal','Gianluca Muzzillo','stage_entered',3,3,true),
  ('sales','Proposal',array['Custom/Private']::text[],'Approve budget','From Airtable (Proposal, due “+4d stage”).','Financial','Peppe Mannella','stage_entered',4,4,true),
  ('sales','Proposal',array['Custom/Private']::text[],'Create proposal in Nivo — send to Cherrye or Lulu for review','From Airtable (Proposal, due “+7d stage”).','Creation','Gianluca Muzzillo','stage_entered',7,5,true),
  ('sales','Proposal',array['Custom/Private']::text[],'Proposal reviewed by Lulu','From Airtable (Proposal, due “+8d stage”).','Internal','Lulu Bianco','stage_entered',8,6,true),
  ('sales','Proposal',array['Custom/Private']::text[],'Send proposal to client','From Airtable (Proposal, due “+9d stage”).','Client-facing','Gianluca Muzzillo','stage_entered',9,7,true),
  ('sales','Booked',array['Custom/Private']::text[],'Move Nutshell lead to Booked','From Airtable (Booking, due “+1d stage”).','System Update','Lulu Bianco','stage_entered',1,0,true),
  ('sales','Booked',array['Custom/Private']::text[],'Add booking participants to Nutshell','From Airtable (Booking, due “+1d stage”).','System Update','Lulu Bianco','stage_entered',1,1,true),
  ('sales','Booked',array['Custom/Private']::text[],'Save approved proposal to Google Drive','From Airtable (Booking, due “+1d stage”).','System Update','Gianluca Muzzillo','stage_entered',1,2,true),
  ('sales','Booked',array['Custom/Private']::text[],'Forward booking confirmation to Cole','From Airtable (Booking, due “+1d stage”).','Internal','Gianluca Muzzillo','stage_entered',1,3,true),
  ('sales','Booked',array['Custom/Private']::text[],'Confirm vendors','From Airtable (Booking, due “+1d stage”).','Vendor','Gianluca Muzzillo','stage_entered',1,4,true),
  ('sales','Booked',array['Custom/Private']::text[],'Update Nivo description','From Airtable (Booking, due “+1d stage”).','System Update','Gianluca Muzzillo','stage_entered',1,5,true),
  ('sales','Booked',array['Custom/Private']::text[],'Confirm trip dates in shared Google Calendar','From Airtable (Booking, due “+2d stage”).','System Update','Peppe Mannella','stage_entered',2,6,true),
  ('sales','Booked',array['Custom/Private']::text[],'Deduct upfront fee from invoice','From Airtable (Booking, due “+2d stage”).','Financial','Peppe Mannella','stage_entered',2,7,true),
  ('sales','Booked',array['Custom/Private']::text[],'Pay vendor deposits','From Airtable (Booking, due “+2d stage”).','Financial','Peppe Mannella','stage_entered',2,8,true),
  ('sales','Booked',array['Custom/Private']::text[],'Finalize itinerary for clients','From Airtable (Itinerary, due “-8w depart”).','Creation','Gianluca Muzzillo','trip_start',-56,9,true),
  ('sales','Booked',array['Custom/Private']::text[],'Confirm flight information','From Airtable (Itinerary, due “-8w depart”).','Client-facing','Gianluca Muzzillo','trip_start',-56,10,true),
  ('sales','Booked',array['Custom/Private']::text[],'Send rooming list and passports to hotels','From Airtable (Itinerary, due “-8w depart”).','Vendor','Gianluca Muzzillo','trip_start',-56,11,true),
  ('sales','Booked',array['Custom/Private']::text[],'Create Tella video','From Airtable (Itinerary, due “-6w depart”).','Creation','Gianluca Muzzillo','trip_start',-42,12,true),
  ('sales','Booked',array['Custom/Private']::text[],'Send final itinerary and Tella to client','From Airtable (Itinerary, due “-6w depart”).','Client-facing','Gianluca Muzzillo','trip_start',-42,13,true),
  ('sales','Booked',array['Custom/Private']::text[],'Make final vendor payments','From Airtable (Itinerary, due “-6w depart”).','Financial','Peppe Mannella','trip_start',-42,14,true),
  ('sales','Booked',array['Custom/Private']::text[],'Create guide brief','From Airtable (Briefs, due “-6w depart”).','Creation','Peppe Mannella','trip_start',-42,15,true),
  ('sales','Booked',array['Custom/Private']::text[],'Send brief to guide, driver, and trip manager','From Airtable (Briefs, due “-6w depart”).','Internal','Peppe Mannella','trip_start',-42,16,true),
  ('sales','Booked',array['Custom/Private']::text[],'Send welcome note and gift to room','From Airtable (Itinerary, due “-1w depart”).','Client-facing','Gianluca Muzzillo','trip_start',-7,17,true),
  ('sales','Booked',array['Custom/Private']::text[],'Invoice paid in full — confirm in Nivo','From Airtable (Itinerary, due “per Nivo date”).','Financial','Gianluca Muzzillo',null,null,18,true),
  ('sales','Booked',array['Custom/Private']::text[],'Move Nutshell lead to Currently Traveling','From Airtable (Itinerary, due “+0d Travel Start”).','System Update','Lulu Bianco','trip_start',0,19,true),
  ('sales','Booked',array['Custom/Private']::text[],'Move Nutshell lead to Completed','From Airtable (Post-Trip, due “+1d Travel End”).','System Update','Lulu Bianco','trip_end',1,20,true),
  ('sales','Booked',array['Custom/Private']::text[],'Reconcile budget','From Airtable (Post-Trip, due “+7d Travel End”).','Financial','Peppe Mannella','trip_end',7,21,true),
  ('sales','Booked',array['Custom/Private']::text[],'Approve final budget','From Airtable (Post-Trip, due “+7d Travel End”).','Financial','Peppe Mannella','trip_end',7,22,true),
  ('sales','Booked',array['Custom/Private']::text[],'Send personalized thank you to client','From Airtable (Post-Trip, due “+42d Travel End”).','Client-facing','Lulu Bianco','trip_end',42,23,true),
  ('sales','Inquiry',array['B2B']::text[],'Create Lead in Nutshell – Agents Pipeline','From Airtable (B2B Pre-Booking, due “on intake”).','System Update','Cherrye Moore','stage_entered',0,0,true),
  ('sales','Inquiry',array['B2B']::text[],'Outline tour','From Airtable (B2B Pre-Booking, due “on intake”).','Creation','Cherrye Moore','stage_entered',0,1,true),
  ('sales','Inquiry',array['B2B']::text[],'Create Budget Spreadsheet and note how MBV will pay vendors','From Airtable (B2B Pre-Booking, due “on intake”).','Financial','Cherrye Moore','stage_entered',0,2,true),
  ('sales','Inquiry',array['B2B']::text[],'Add proposal to Softrip','From Airtable (B2B Pre-Booking, due “on intake”).','Creation','Cherrye Moore','stage_entered',0,3,true),
  ('sales','Inquiry',array['B2B']::text[],'Send proposal/budget to supervisor for approval','From Airtable (B2B Pre-Booking, due “+1d intake”).','Internal','Cherrye Moore','stage_entered',1,4,true),
  ('sales','Inquiry',array['B2B']::text[],'Proposal approved','From Airtable (B2B Pre-Booking, due “+2d intake”).','Internal','Peppe Mannella','stage_entered',2,5,true),
  ('sales','Inquiry',array['B2B']::text[],'Send proposal to agent','From Airtable (B2B Pre-Booking, due “+4d intake”).','Client-facing','Cherrye Moore','stage_entered',4,6,true),
  ('sales','Inquiry',array['B2B']::text[],'Move Nutshell lead to Proposal Stage','From Airtable (B2B Pre-Booking, due “+4d intake”).','System Update','Cherrye Moore','stage_entered',4,7,true),
  ('sales','Booked',array['B2B']::text[],'Agent confirms clients approved trip','From Airtable (B2B Booking, due “per Nivo booking deadline”).','Client-facing','Cherrye Moore',null,null,0,true),
  ('sales','Booked',array['B2B']::text[],'Move Nutshell lead to Book Stage','From Airtable (B2B Booking, due “on booking confirmed”).','System Update','Cherrye Moore','stage_entered',0,1,true),
  ('sales','Booked',array['B2B']::text[],'Book vendors','From Airtable (B2B Booking, due “per Nivo deadlines”).','Vendor','Peppe Mannella',null,null,2,true),
  ('sales','Booked',array['B2B']::text[],'Pay deposits to vendors','From Airtable (B2B Booking, due “per Nivo deadlines”).','Financial','Peppe Mannella',null,null,3,true),
  ('sales','Booked',array['B2B']::text[],'Collect passports for all travelers','From Airtable (B2B Booking, due “-8w depart”).','Client-facing','Cherrye Moore','trip_start',-56,4,true),
  ('sales','Booked',array['B2B']::text[],'Invoice paid in full','From Airtable (Pre-Departure, due “-6w depart”).','Financial','Peppe Mannella','trip_start',-42,5,true),
  ('sales','Booked',array['B2B']::text[],'Confirm rooming list and send to hotels','From Airtable (B2B Booking, due “-4w depart”).','Vendor','Peppe Mannella','trip_start',-28,6,true),
  ('sales','Booked',array['B2B']::text[],'Welcome note / gift organized for their room','From Airtable (Pre-Departure, due “-2w depart”).','Client-facing','Cherrye Moore','trip_start',-14,7,true),
  ('sales','Booked',array['B2B']::text[],'Final itinerary prepared','From Airtable (Pre-Departure, due “-1w depart”).','Creation','Cherrye Moore','trip_start',-7,8,true),
  ('sales','Booked',array['B2B']::text[],'Final itinerary and instructions sent to agent','From Airtable (Pre-Departure, due “-1w depart”).','Client-facing','Cherrye Moore','trip_start',-7,9,true),
  ('sales','Booked',array['B2B']::text[],'Final vendor payments made','From Airtable (Pre-Departure, due “-1w depart”).','Financial','Peppe Mannella','trip_start',-7,10,true),
  ('sales','Booked',array['B2B']::text[],'Guide brief created','From Airtable (Briefs, due “-1w depart”).','Creation','Peppe Mannella','trip_start',-7,11,true),
  ('sales','Booked',array['B2B']::text[],'Guide brief sent to guide, driver, and Jesse','From Airtable (Briefs, due “-1w depart”).','Internal','Peppe Mannella','trip_start',-7,12,true),
  ('sales','Booked',array['B2B']::text[],'Move Nutshell lead to Completed','From Airtable (Pre-Departure, due “day of depart”).','System Update','Cherrye Moore','trip_start',0,13,true),
  ('sales','Booked',array['B2B']::text[],'Thank you note sent to agent','From Airtable (Post-Trip, due “+1d return”).','Client-facing','Cherrye Moore','trip_end',1,14,true),
  ('sales','Booked',array['B2B']::text[],'Budget reconciled','From Airtable (Post-Trip, due “+1w return”).','Financial','Peppe Mannella','trip_end',7,15,true),
  ('sales','Booked',array['B2B']::text[],'Final budget approved','From Airtable (Post-Trip, due “+1w return”).','Financial','Peppe Mannella','trip_end',7,16,true),
  ('sales','Booked',array['B2B']::text[],'Reach out to agent for feedback','From Airtable (Post-Trip, due “+1w return”).','Client-facing','Cherrye Moore','trip_end',7,17,true),
  ('sales','In Creation',array['Small Group']::text[],'Build draft itinerary','From Airtable (Tour Development, due “15m+ before depart”).','Creation','Cherrye Moore','trip_start',-456,0,true),
  ('sales','In Creation',array['Small Group']::text[],'Create budget spreadsheet','From Airtable (Tour Development, due “+1d draft complete”).','Financial','Cherrye Moore','stage_entered',1,1,true),
  ('sales','In Creation',array['Small Group']::text[],'Add trip to Google Calendar','From Airtable (Tour Development, due “+1d draft complete”).','Internal','Cherrye Moore','stage_entered',1,2,true),
  ('sales','In Creation',array['Small Group']::text[],'Create itinerary in Nivo','From Airtable (Tour Development, due “+3d budget done”).','System Update','Cherrye Moore','stage_entered',4,3,true),
  ('sales','In Creation',array['Small Group']::text[],'Assign MBV tour host','From Airtable (Tour Development, due “before pre-launch”).','Internal','Cherrye Moore',null,null,4,true),
  ('sales','In Creation',array['Small Group']::text[],'Collect high-res photos for itinerary and promo','From Airtable (Marketing / Launch, due “-1w launch”).','Creation','Cherrye Moore',null,null,5,true),
  ('sales','In Creation',array['Small Group']::text[],'Create private Facebook group','From Airtable (Marketing / Launch, due “-6m depart”).','Internal','Lulu Bianco','trip_start',-182,6,true),
  ('sales','Booked',array['Small Group']::text[],'Minimum booking number reached','From Airtable (Booking, due “per Nivo”).','Internal','Cherrye Moore','stage_entered',0,0,true),
  ('sales','Booked',array['Small Group']::text[],'Send postcards or mailable gifts','From Airtable (Marketing / Launch, due “on minimum met”).','Client-facing','Lulu Bianco','stage_entered',0,1,true),
  ('sales','Booked',array['Small Group']::text[],'Book vendors','From Airtable (Booking, due “+1w minimum met”).','Vendor','Peppe Mannella','stage_entered',7,2,true),
  ('sales','Booked',array['Small Group']::text[],'Pay vendor deposits','From Airtable (Booking, due “+3d vendor booking”).','Financial','Peppe Mannella','stage_entered',10,3,true),
  ('sales','Booked',array['Small Group']::text[],'Collect passport information','From Airtable (Booking, due “+2w booking”).','Client-facing','Cherrye Moore','stage_entered',14,4,true),
  ('sales','Booked',array['Small Group']::text[],'Invoice paid in full','From Airtable (Pre-Departure, due “-60d depart”).','Financial','Peppe Mannella','trip_start',-60,5,true),
  ('sales','Booked',array['Small Group']::text[],'Confirm rooming list and send to hotels','From Airtable (Booking, due “-6w depart”).','Vendor','Peppe Mannella','trip_start',-42,6,true),
  ('sales','Booked',array['Small Group']::text[],'Briefs created','From Airtable (Briefs, due “-6w depart”).','Internal','Peppe Mannella','trip_start',-42,7,true),
  ('sales','Booked',array['Small Group']::text[],'Final itinerary ready in Nivo','From Airtable (Pre-Departure, due “-6w depart”).','Creation','Cherrye Moore','trip_start',-42,8,true),
  ('sales','Booked',array['Small Group']::text[],'Final itinerary and Tella Video sent to guests','From Airtable (Pre-Departure, due “-6w depart”).','Client-facing','Cherrye Moore','trip_start',-42,9,true),
  ('sales','Booked',array['Small Group']::text[],'Set up WhatsApp group chat','From Airtable (Pre-Departure, due “-2w depart”).','Client-facing','Lulu Bianco','trip_start',-14,10,true),
  ('sales','Booked',array['Small Group']::text[],'Welcome WhatsApp message sent to guests','From Airtable (Pre-Departure, due “-1w depart”).','Client-facing','Cherrye Moore','trip_start',-7,11,true),
  ('sales','Booked',array['Small Group']::text[],'Prepare welcome note or room gift','From Airtable (Pre-Departure, due “-1w depart”).','Client-facing','Cherrye Moore','trip_start',-7,12,true),
  ('sales','Booked',array['Small Group']::text[],'Final vendor payments made','From Airtable (Pre-Departure, due “-1w depart”).','Financial','Peppe Mannella','trip_start',-7,13,true),
  ('sales','Booked',array['Small Group']::text[],'Move Nutshell lead to Traveling','From Airtable (Pre-Departure, due “day of depart”).','System Update','Lulu Bianco','trip_start',0,14,true),
  ('sales','Booked',array['Small Group']::text[],'Move Nutshell lead to Returned','From Airtable (Post-Trip, due “+1d return”).','System Update','Lulu Bianco','trip_end',1,15,true),
  ('sales','Booked',array['Small Group']::text[],'Budget reconciled and approved','From Airtable (Post-Trip, due “+1w return”).','Financial','Peppe Mannella','trip_end',7,16,true),
  ('sales','Booked',array['Small Group']::text[],'Thank-you or postcard sent to each guest','From Airtable (Post-Trip, due “+6w return”).','Client-facing','Lulu Bianco','trip_end',42,17,true),
  ('flag','heritage','{}'::text[],'Delegation Form sent to client','From Airtable (Heritage, due “-8w depart”).','Client-facing','Lulu Bianco','trip_start',-56,0,true),
  ('flag','heritage','{}'::text[],'All Heritage documents received','From Airtable (Heritage, due “-8w depart”).','Internal','Lulu Bianco','trip_start',-56,1,true),
  ('flag','heritage','{}'::text[],'Heritage documents sent to Heritage Specialist','From Airtable (Heritage, due “-7w depart”).','Client-facing','Lulu Bianco','trip_start',-49,2,true),
  ('flag','heritage','{}'::text[],'Arrange meeting with heritage specialist','From Airtable (Itinerary, due “-6w depart”).','Internal','Gianluca Muzzillo','trip_start',-42,3,true),
  ('flag','heritage','{}'::text[],'Hold meeting with heritage specialist','From Airtable (Itinerary, due “-6w depart”).','Internal','Gianluca Muzzillo','trip_start',-42,4,true),
  ('flag','heritage','{}'::text[],'Send family info to heritage specialist','From Airtable (Heritage, due “-8w depart”).','Internal','Lulu Bianco','trip_start',-56,5,false),
  ('flag','heritage','{}'::text[],'Confirm delegation form signed and returned','From Airtable (Heritage, due “-7w depart”).','Client-facing','Lulu Bianco','trip_start',-49,6,false),
  ('flag','heritage','{}'::text[],'Confirm heritage documents received from client','From Airtable (Heritage, due “-7w depart”).','Client-facing','Lulu Bianco','trip_start',-49,7,false),
  ('flag','heritage','{}'::text[],'Confirm passport received from client','From Airtable (Heritage, due “-7w depart”).','Client-facing','Lulu Bianco','trip_start',-49,8,false),
  ('flag','heritage','{}'::text[],'Send all documents to heritage specialist','From Airtable (Heritage, due “-6w depart”).','Internal','Lulu Bianco','trip_start',-42,9,false)
)
insert into public.task_templates (tenant_id, stage_system, stage, trip_types, name, description, task_type,
  default_member_id, due_anchor, due_offset_days, reminder_offsets, position, active)
select t.id, v.stage_system, v.stage, v.trip_types, v.name, v.description, v.task_type,
  (select m.id from public.team_members m where m.tenant_id = t.id and m.name = v.member),
  v.due_anchor, v.due_offset_days, '{1}', v.pos, v.active
from t, v
where not exists (select 1 from public.task_templates x
                  where x.tenant_id = t.id and x.stage_system = v.stage_system and x.stage = v.stage
                    and x.trip_types = v.trip_types and x.name = v.name);
