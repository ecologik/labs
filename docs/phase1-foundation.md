# Phase 1 · Step 1 — Foundation

What this step adds, and the one-time setup to switch it on.

## What's in it

**Database** (`supabase/migrations/20261031000100_foundation.sql`)

| Table | Purpose |
|---|---|
| `tenants` | One row per client. `modules` = on/off flags (gifts, guide_schedule, nivo, heritage, guide_note). `settings` = stage lists, trip types, task types. |
| `team_members` | Office roster. |
| `guides` | Field guides. `team_member_id` links a guide who is also on staff (Peppe). |
| `memberships` | A Google login → tenant + role (`staff` / `admin` / `guide`), linked to a team member or guide. |
| `invitations` | Admin invites an email + role. First Google sign-in turns it into a membership automatically. |
| `trips` | Core trip. `sales_stage` (pipeline) and `trip_stage` (index into the trip-stage list) are separate. Travel-only fields live in `details` jsonb. `source` + `external_ref` give idempotent upserts for the Nivo adapter later. |
| `trip_team_roles` | The several capacities a person plays on a trip. |
| `tasks`, `task_assignees` | Tasks with many assignees. `gate` = trip stage at which a task leaves the queue. |
| `task_activity` | Append-only audit log written by a trigger: who changed status / due date / name, and when. Powers "moved by …". |

Security rules, all enforced in the database:

- Every table has `tenant_id` and RLS on. Child rows reference parents by `(tenant_id, id)`, so a task can't point at another client's trip even by mistake. `tenant_id` can't be changed after insert.
- **staff**: full read/write on trips and tasks; reads the roster.
- **admin**: staff + edits roster, guides, invitations, memberships, tenant settings.
- **guide**: reads tenant + guide list only. The Calendar/Heritage slice is granted by those modules' migrations.
- **anon**: no table access at all. Nobody can write `task_activity` directly.

`supabase/tests/rls_foundation.sql` checks all of the above (cross-tenant reads and writes, self-promotion, forged audit rows, guide read-only, invitation claim). Run with `npm run test:db` against any throwaway Postgres 15+ (`PGHOST`/`PGPORT`/`PGUSER` env).

**App**

- Google sign-in, "no access yet" screen for un-invited accounts, tenant switcher if a login belongs to more than one tenant.
- Staff: Trips (pipeline by sales stage or cards, type filter, search, + New trip), trip page with the trip-stage rail, tasks with quick-add, status changes, and the "Tasks in queue" holder; My Tasks and Team Tasks grouped by urgency.
- Guides: Calendar and Heritage placeholders (filled in by the module steps).
- Every query also filters by `tenant_id` explicitly, on top of RLS.

## One-time setup

1. **Run the migration** — Supabase dashboard → SQL Editor → paste `supabase/migrations/20261031000100_foundation.sql` → Run. (Or `supabase db push` if you use the CLI.)
2. **Seed Bella** — run `supabase/seed.sql` (tenant, settings, team, guides; no emails). Optional on a dev project: `supabase/seed.demo.sql` for three made-up trips.
3. **Invite yourself** — in the SQL Editor (keep real emails out of the repo):
   ```sql
   insert into public.invitations (tenant_id, email, role, team_member_id)
   select t.id, 'YOUR-EMAIL', 'admin', null from public.tenants t where t.slug = 'bella';
   ```
   For Cherrye and the team, pass their `team_member_id` so "My Tasks" works for them.
4. **Turn on Google sign-in**
   - Google Cloud Console → APIs & Services → Credentials → OAuth client ID (Web). Authorized redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`.
   - Supabase → Authentication → Sign In / Providers → Google: paste the client ID + secret, enable.
   - Supabase → Authentication → URL Configuration: Site URL `https://labs.ecologik.net`; Redirect URLs add `http://localhost:5173/**`, `http://localhost:5174/**` and `https://labs.ecologik.net/**`.
5. `npm install` (adds `@supabase/supabase-js`), then `npm run dev` and sign in.

## Next steps in the build order

Tasks engine: reminders (+ daily email job), rich task create/edit modal with "moved by" tags from `task_activity`, task templates keyed on (stage system, stage, trip type) generating gated tasks.
