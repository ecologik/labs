# EcoLogik Labs — project context for Claude Code

## What this is
A multi-tenant web app. **Bella (My Bella Vita Dash) is tenant #1**, but the build is
designed so other clients run on the *same* codebase and deployment — not forks.

## Stack
- Front end: Vite + React (SPA). Dev: `npm run dev` → http://localhost:5174.
- Backend: **Supabase** (Postgres + Auth + Row-Level Security). Client env in `.env.local`
  (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`). `.env*` is gitignored.
  Never commit the service_role key. Anon key is fine in the browser.
- Prod: static build deployed to cPanel at labs.ecologik.net (behind Sucuri). `npm run build`
  → ship `dist/` to the docroot. Keep the SPA `.htaccess`. Clear Sucuri cache after deploy.

## Architecture — three independent layers, ONE build
1. **Core (shared by every tenant):** Trips + Tasks + team/roles.
2. **Sources (per client — how trips arrive):** an adapter layer that normalizes any input
   into the common Trip shape. Nivo (API or public-page scrape) is adapter #1 for Bella;
   others may use a Gravity Forms webhook, CSV, or manual entry. Every trip stores
   `source` + `external_ref` for idempotent upserts.
3. **Modules (per client — optional, on/off flags on the tenant):** gifts, guide schedule,
   Nivo itinerary, heritage folders, Guide Note PDF. Bella = all on; Tasks-only clients = none.

## Hard rules
- **Every table has `tenant_id`, and RLS is enforced from the first migration.** Never write a
  query or table without tenant scoping. A cross-tenant data leak is the worst failure here.
- Roles: `staff` (full), `admin` (full + accounts/settings), `guide` (read-only, sees only the
  Calendar + Heritage).
- Keep each module a self-contained feature, gated by its flag. Do NOT hardcode Bella-specific
  things (Nivo, gifts, "Trip" travel fields) into the Core.
- Build now: tenant_id + RLS, the source-adapter seam, module flags. Defer until a 2nd client
  signs: subdomains, onboarding UI, config-driven field mapper, billing.

## Build order
Foundation (DB, auth, roles, trips, tasks) → Tasks engine (reminders, move-accountability,
staged queue, task templates) → guide schedule/calendar, gifts, heritage → Nivo adapter +
review/accept, Google Drive, Guide Note.