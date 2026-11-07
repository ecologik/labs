import { useState } from 'react'
import { dueRuleText } from '../lib/format'

const REMINDERS = [
  { v: 0, l: 'On the day' }, { v: 1, l: '1 day before' }, { v: 3, l: '3 days before' },
  { v: 7, l: '1 week before' }, { v: 14, l: '2 weeks before' },
]

export default function TemplateModal({ template, settings, team, flags = [], onSave, onDelete, onClose }) {
  const [t, setT] = useState(() => ({
    ...template,
    // Show offsets for trip start/end as "N days before/after" instead of a signed number.
    _when: (template.due_offset_days ?? 0) < 0 ? 'before' : 'after',
    _days: Math.abs(template.due_offset_days ?? 0),
  }))
  const set = (k, v) => setT(x => ({ ...x, [k]: v }))
  const isFlag = t.stage_system === 'flag'
  const stages = isFlag ? flags.map(f => f.key) : t.stage_system === 'sales' ? settings.sales_stages || [] : settings.trip_stages || []
  const stageName = st => isFlag ? flags.find(f => f.key === st)?.label ?? st : st
  const tripTypes = settings.trip_types || []
  const taskTypes = settings.task_types || []

  const toggleIn = (k, v) => setT(x => ({ ...x, [k]: x[k].includes(v) ? x[k].filter(y => y !== v) : [...x[k], v] }))
  const offset = t.due_anchor === 'stage_entered' ? Number(t._days) || 0
    : (t._when === 'before' ? -1 : 1) * (Number(t._days) || 0)
  const preview = { ...t, due_offset_days: offset }

  const submit = e => {
    e.preventDefault()
    if (!t.name.trim()) return
    const { _when, _days, ...rest } = t
    void _when; void _days
    onSave({ ...rest, due_offset_days: offset })
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <form className="modal wide" onClick={e => e.stopPropagation()} onSubmit={submit}>
        <h2>{t.id ? 'Edit task template' : 'New task template'}</h2>
        <label>Task<input required autoFocus value={t.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Send proposal to agent" /></label>
        <label>Notes for whoever does it<textarea rows={2} value={t.description ?? ''} onChange={e => set('description', e.target.value)} /></label>
        <div className="row2">
          <label>{isFlag ? 'Added when ticked' : t.stage_system === 'sales' ? 'Sales stage' : 'Trip stage'}
            <select value={t.stage} onChange={e => set('stage', e.target.value)}>
              {!stages.includes(t.stage) && <option value={t.stage}>{t.stage} (removed)</option>}
              {stages.map(s => <option key={s} value={s}>{stageName(s)}</option>)}
            </select>
          </label>
          <label>Task type
            <select value={t.task_type ?? ''} onChange={e => set('task_type', e.target.value)}>
              <option value="">—</option>
              {taskTypes.map(s => <option key={s}>{s}</option>)}
            </select>
          </label>
        </div>

        <fieldset>
          <legend>Trip types</legend>
          <div className="checks">
            {tripTypes.map(tt => (
              <label key={tt} className="check"><input type="checkbox" checked={t.trip_types.includes(tt)} onChange={() => toggleIn('trip_types', tt)} />{tt}</label>
            ))}
          </div>
          <span className="muted small">{t.trip_types.length === 0 ? 'None ticked = every trip type gets this task.' : `Only ${t.trip_types.join(', ')} trips get this task.`}</span>
        </fieldset>

        <fieldset>
          <legend>Due date</legend>
          <div className="due-rule">
            <select value={t.due_anchor ?? ''} onChange={e => set('due_anchor', e.target.value || null)}>
              <option value="">No due date</option>
              <option value="stage_entered">Days after it’s added</option>
              <option value="trip_start">Relative to trip start</option>
              <option value="trip_end">Relative to trip end</option>
            </select>
            {t.due_anchor && <input type="number" min="0" value={t._days} onChange={e => set('_days', e.target.value)} />}
            {t.due_anchor && t.due_anchor !== 'stage_entered' && (
              <select value={t._when} onChange={e => set('_when', e.target.value)}>
                <option value="before">days before</option><option value="after">days after</option>
              </select>
            )}
          </div>
          <span className="muted small">{dueRuleText(preview)}</span>
        </fieldset>

        <div className="row2">
          <label>Assign to
            <select value={t.default_member_id ?? ''} onChange={e => set('default_member_id', e.target.value || null)}>
              <option value="">The trip’s lead</option>
              {team.filter(m => m.active).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
          <label className="check-inline"><input type="checkbox" checked={t.active} onChange={e => set('active', e.target.checked)} />Turned on</label>
        </div>

        <fieldset>
          <legend>Reminders (email to the assignee)</legend>
          <div className="checks">
            {REMINDERS.map(r => (
              <label key={r.v} className="check"><input type="checkbox" checked={t.reminder_offsets.includes(r.v)} onChange={() => toggleIn('reminder_offsets', r.v)} />{r.l}</label>
            ))}
          </div>
        </fieldset>

        <div className="modal-f">
          {onDelete && <button type="button" className="btn danger" style={{ marginRight: 'auto' }} onClick={onDelete}>Delete</button>}
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn">Save</button>
        </div>
      </form>
    </div>
  )
}
