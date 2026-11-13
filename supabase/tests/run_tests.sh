#!/usr/bin/env bash
# Runs the migrations + RLS tests against a throwaway plain-Postgres database.
# Usage: PGHOST=... PGPORT=... PGUSER=postgres supabase/tests/run_tests.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=labs_rls_test
psql -q -d postgres -c "drop database if exists $DB" -c "create database $DB"
P="psql -q -o /dev/null -v ON_ERROR_STOP=1 -d $DB"
$P -f supabase/tests/stub_supabase.sql
for f in supabase/migrations/*.sql; do echo "migrate $f"; $P -f "$f"; done
$P -f supabase/seed.sql
$P -f supabase/seed.sql   # seed must be idempotent
$P -f supabase/tests/rls_foundation.sql
$P -f supabase/tests/rls_tasks_engine.sql
$P -f supabase/tests/rls_settings_admin.sql
$P -f supabase/tests/rls_flags_notes.sql
$P -f supabase/tests/rls_remove_tasks.sql
$P -f supabase/seed.templates.sql   # real templates must load cleanly
$P -f supabase/seed.templates.sql   # and be idempotent
$P -f supabase/tests/rls_trip_details.sql
$P -f supabase/tests/rls_guide_schedule.sql
$P -f supabase/tests/rls_branding.sql
$P -f supabase/tests/rls_destinations.sql
$P -f supabase/tests/rls_contacts.sql
$P -f supabase/tests/rls_invites.sql
