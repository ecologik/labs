import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'

// Every query below is scoped by tenant_id explicitly, on top of RLS.

const TRIP_COLS = 'id, name, trip_type, sales_stage, trip_stage, start_date, end_date, details, lead_id, source, external_ref'
const TASK_COLS = 'id, trip_id, template_id, name, description, task_type, status, due_date, gate, completed_at, tags, note, note_updated_at, task_assignees(team_member_id)'

export async function fetchTrips(tenantId) {
  const { data, error } = await supabase.from('trips').select(TRIP_COLS)
    .eq('tenant_id', tenantId).eq('archived', false).order('start_date', { ascending: true, nullsFirst: false })
  if (error) throw error
  return data
}

export async function fetchTasks(tenantId) {
  const { data, error } = await supabase.from('tasks').select(TASK_COLS)
    .eq('tenant_id', tenantId).is('dismissed_at', null).order('due_date', { ascending: true, nullsFirst: false })
  if (error) throw error
  return data.map(t => ({ ...t, assignees: t.task_assignees.map(a => a.team_member_id) }))
}

// Select with the contact columns; until the phone migration (setup step 12) is run,
// fall back to the columns that exist so the app keeps working.
async function selectPeople(table, tenantId, cols, extra) {
  let r = await supabase.from(table).select(cols + ', ' + extra).eq('tenant_id', tenantId).order('name')
  if (r.error?.code === '42703') r = await supabase.from(table).select(cols).eq('tenant_id', tenantId).order('name')
  if (r.error) throw r.error
  return r.data
}
export const fetchTeam = tenantId => selectPeople('team_members', tenantId, 'id, name, role_title, color, active, email', 'phone')
export const fetchGuides = tenantId => selectPeople('guides', tenantId, 'id, name, color, active, email, team_member_id', 'phone')

const PERSON_COLS = { team_members: ['name', 'role_title', 'email', 'phone', 'color', 'active'], guides: ['name', 'email', 'phone', 'color', 'active', 'team_member_id'] }
// Admin: add or change a team member / guide (RLS: admins only).
export async function savePerson(table, tenantId, p) {
  const row = Object.fromEntries(PERSON_COLS[table].filter(k => k in p).map(k => [k, typeof p[k] === 'string' ? p[k].trim() || null : p[k]]))
  const q = p.id ? supabase.from(table).update(row).eq('tenant_id', tenantId).eq('id', p.id) : supabase.from(table).insert({ ...row, tenant_id: tenantId })
  const { error } = await q
  if (error) throw error
}
export async function deletePerson(table, tenantId, id) {
  const { error } = await supabase.from(table).delete().eq('tenant_id', tenantId).eq('id', id)
  if (error) throw error
}

// Save the "Edit trip details" drawer: core columns plus a merge into details.
// Changing trip type or ticking a flag fires the template engine in the database.
export async function updateTrip(tenantId, trip, fields, detailsPatch = {}) {
  const { error } = await supabase.from('trips')
    .update({ ...fields, details: { ...(trip.details || {}), ...detailsPatch } })
    .eq('tenant_id', tenantId).eq('id', trip.id)
  if (error) throw error
}

// ---------- Guide schedule (module: guide_schedule) ----------
const SEG_COLS = 'id, trip_id, label, start_date, end_date, guide_id, note'

export async function fetchSegments(tenantId, tripId) {
  const { data, error } = await supabase.from('trip_segments').select(SEG_COLS)
    .eq('tenant_id', tenantId).eq('trip_id', tripId).order('start_date')
  if (error) throw error
  return data
}

export async function saveSegment(tenantId, tripId, seg) {
  const row = { label: seg.label, start_date: seg.start_date, end_date: seg.end_date, guide_id: seg.guide_id || null, note: seg.note || null }
  const q = seg.id
    ? supabase.from('trip_segments').update(row).eq('tenant_id', tenantId).eq('id', seg.id)
    : supabase.from('trip_segments').insert({ ...row, tenant_id: tenantId, trip_id: tripId })
  const { error } = await q
  if (error) throw error
}

export async function deleteSegment(tenantId, id) {
  const { error } = await supabase.from('trip_segments').delete().eq('tenant_id', tenantId).eq('id', id)
  if (error) throw error
}

export async function setTaskStatus(tenantId, taskId, status) {
  const { error } = await supabase.from('tasks').update({ status }).eq('tenant_id', tenantId).eq('id', taskId)
  if (error) throw error
}

export async function createTask(tenantId, { tripId, name, taskType, dueDate, assignees = [] }) {
  const { data, error } = await supabase.from('tasks')
    .insert({ tenant_id: tenantId, trip_id: tripId || null, name, task_type: taskType || null, due_date: dueDate || null })
    .select('id').single()
  if (error) throw error
  if (assignees.length) {
    const { error: e2 } = await supabase.from('task_assignees')
      .insert(assignees.map(m => ({ tenant_id: tenantId, task_id: data.id, team_member_id: m })))
    if (e2) throw e2
  }
  return data.id
}

export async function createTrip(tenantId, { name, tripType, salesStage, startDate, endDate, leadId, details = {} }) {
  const { data, error } = await supabase.from('trips').insert({
    tenant_id: tenantId, name, trip_type: tripType || null, sales_stage: salesStage || null,
    start_date: startDate || null, end_date: endDate || null, lead_id: leadId || null, details,
  }).select('id').single()
  if (error) throw error
  return data.id
}

// Take a task off its trip. Template tasks are marked removed (so the template
// never re-adds them); hand-added tasks are deleted outright.
export async function removeTask(tenantId, task) {
  const q = task.template_id
    ? supabase.from('tasks').update({ dismissed_at: new Date().toISOString() })
    : supabase.from('tasks').delete()
  const { error } = await q.eq('tenant_id', tenantId).eq('id', task.id)
  if (error) throw error
}

export async function setTaskNote(tenantId, taskId, note) {
  const { error } = await supabase.from('tasks').update({ note }).eq('tenant_id', tenantId).eq('id', taskId)
  if (error) throw error
}

// Merge keys into trips.details (e.g. { heritage: true }). Flag templates fire in the database.
export async function setTripDetails(tenantId, trip, patch) {
  const { error } = await supabase.from('trips').update({ details: { ...(trip.details || {}), ...patch } })
    .eq('tenant_id', tenantId).eq('id', trip.id)
  if (error) throw error
}

export async function setSalesStage(tenantId, tripId, salesStage) {
  const { error } = await supabase.from('trips').update({ sales_stage: salesStage }).eq('tenant_id', tenantId).eq('id', tripId)
  if (error) throw error
}

// Deletes the trip; its tasks, assignees, reminders and history go with it (FK cascade).
export async function deleteTrip(tenantId, tripId) {
  const { data, error } = await supabase.from('trips').delete().eq('tenant_id', tenantId).eq('id', tripId).select('id')
  if (error) throw error
  if (!data?.length) throw new Error("Trip wasn't deleted (it may already be gone, or your role can't delete it).")
}

export async function setTripStage(tenantId, tripId, tripStage) {
  const { error } = await supabase.from('trips').update({ trip_stage: tripStage }).eq('tenant_id', tenantId).eq('id', tripId)
  if (error) throw error
}

// A task is active once its trip reaches the task's gate; until then it waits in the queue.
export function isQueued(task, tripById) {
  if (task.gate == null || !task.trip_id) return false
  const trip = tripById[task.trip_id]
  return trip ? trip.trip_stage < task.gate : false
}

// Load trips + tasks + team for a tenant, with a reload() for after writes.
export function useTenantData(tenantId, enabled) {
  const [state, setState] = useState({ loading: true, error: null, trips: [], tasks: [], team: [], guides: [] })
  const reload = useCallback(async () => {
    if (!tenantId || !enabled) return
    try {
      const [trips, tasks, team, guides] = await Promise.all([fetchTrips(tenantId), fetchTasks(tenantId), fetchTeam(tenantId), fetchGuides(tenantId)])
      setState({ loading: false, error: null, trips, tasks, team, guides })
    } catch (e) {
      setState(s => ({ ...s, loading: false, error: e.message }))
    }
  }, [tenantId, enabled])
  useEffect(() => { reload() }, [reload])
  return { ...state, reload }
}
