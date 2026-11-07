export function parseDate(s) { return s ? new Date(s + 'T00:00:00') : null }
export function fmtDate(s) {
  const d = parseDate(s)
  return d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'
}
export function fmtRange(a, b) {
  if (!a) return 'Dates TBD'
  const end = parseDate(b)
  return `${fmtDate(a)} – ${fmtDate(b)}${end ? ', ' + end.getFullYear() : ''}`
}
export function today() { const d = new Date(); d.setHours(0, 0, 0, 0); return d }
export function daysFromToday(s) {
  const d = parseDate(s); if (!d) return null
  return Math.round((d - today()) / 86400000)
}
// Urgency bucket for a task's due date.
export function dueBucket(task) {
  if (task.status === 'Complete') return 'done'
  const n = daysFromToday(task.due_date)
  if (n == null) return 'nodate'
  if (n < 0) return 'overdue'
  if (n <= 7) return 'week'
  return 'later'
}
export const BUCKET_LABEL = { overdue: 'Overdue', week: 'Due this week', later: 'Later', nodate: 'No due date', done: 'Complete' }
export const STATUSES = ['Not Started', 'In Progress', 'Waiting on Client', 'Complete']
export const cls = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-')

// Plain-English due-date rule for a task template.
export function dueRuleText(t) {
  const n = t.due_offset_days ?? 0
  const days = Math.abs(n) === 1 ? '1 day' : `${Math.abs(n)} days`
  if (!t.due_anchor) return 'No due date'
  if (t.due_anchor === 'stage_entered') return n === 0 ? 'Due the day it’s added' : `Due ${days} after it’s added`
  const what = t.due_anchor === 'trip_start' ? 'trip start' : 'trip end'
  if (n === 0) return `Due on ${what}`
  return n < 0 ? `Due ${days} before ${what}` : `Due ${days} after ${what}`
}
