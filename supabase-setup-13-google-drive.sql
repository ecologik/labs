-- =============================================================================
-- EcoLogik Labs — Supabase step 13: turn on Google Drive for Bella
-- Paste into Supabase → SQL Editor → Run. Safe to re-run.
-- Needs: the "drive" Edge Function deployed and the GOOGLE_SERVICE_ACCOUNT secret set.
-- =============================================================================
update public.tenants
   set modules  = modules || '{"drive": true}'::jsonb,
       settings = jsonb_set(settings, '{drive}', '{"name": "01 | Trips"}'::jsonb, true)
 where slug = 'bella';

-- Check — should show true and 01 | Trips:
select modules -> 'drive' as drive_on, settings -> 'drive' ->> 'name' as shared_drive from public.tenants where slug = 'bella';
