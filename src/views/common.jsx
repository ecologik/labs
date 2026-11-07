import { createContext, useContext, useState } from 'react'
import { STATUSES, cls, dueBucket, fmtDate } from '../lib/format'
import { useSession } from '../lib/session'

export function Avatar({ member, sm }) {
  if (!member) return null
  const initials = member.name.split(/\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase()
  return <span className={'av' + (sm ? ' sm' : '')} style={{ background: member.color || '#8b837c' }} title={member.name}>{initials}</span>
}

export function AvatarStack({ ids, teamById }) {
  if (!ids?.length) return <span className="muted small">Unassigned</span>
  return <span className="avstack">{ids.map(id => <Avatar key={id} member={teamById[id]} sm />)}</span>
}

export function Chip({ kind, children }) {
  return <span className={`chip ${kind}-${cls(children)}`}>{children}</span>
}

export function StatusSelect({ value, onChange, disabled }) {
  return (
    <select className={'status-sel st-' + cls(value)} value={value} disabled={disabled}
      onChange={e => onChange(e.target.value)} onClick={e => e.stopPropagation()}>
      {STATUSES.map(s => <option key={s}>{s}</option>)}
    </select>
  )
}

// Badge for a tag that came from a trip flag (e.g. Heritage).
export function FlagBadge({ label }) {
  return <span className="flag-badge" title={`${label} task`}>✦ {label}</span>
}

export function NoteEditor({ task, onSave, onClose, prompt }) {
  const [v, setV] = useState(task.note ?? '')
  const [busy, setBusy] = useState(false)
  const save = async () => { setBusy(true); try { await onSave(v) ; onClose() } finally { setBusy(false) } }
  return (
    <div className="note-edit">
      {prompt && <div className="muted small">Marked complete. Add a note? (optional)</div>}
      <textarea rows={3} autoFocus value={v} placeholder="Add a note for the team…" onChange={e => setV(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save() }} />
      <div className="note-f">
        <button className="btn ghost" onClick={onClose}>{prompt ? 'Skip' : 'Cancel'}</button>
        <button className="btn" disabled={busy || v === (task.note ?? '')} onClick={save}>Save note</button>
      </div>
    </div>
  )
}

export function TaskRow({ task, trip, teamById, onStatus, onNote, onRemove, showTrip = true }) {
  const { tenant } = useSession()
  const flagLabel = Object.fromEntries((tenant?.settings?.trip_flags || []).map(f => [f.key, f.label]))
  const [noteOpen, setNoteOpenState] = useState(null)   // null | 'edit' | 'complete'
  const pin = useContext(FilterPin)
  const setNoteOpen = v => { setNoteOpenState(v); if (pin) v ? pin.pin(task.id) : pin.unpin(task.id) }
  const b = dueBucket(task)
  const changeStatus = s => {
    if (s === 'Complete' && onNote && !task.note) setNoteOpen('complete')
    onStatus(task, s)
  }
  return (
    <div className={'task-row' + (task.status === 'Complete' ? ' done' : '') + ((task.tags || []).length ? ' flagged' : '')}>
      <div className="task-main">
        <div className="task-name">{task.name}</div>
        <div className="task-meta">
          {(task.tags || []).filter(t => flagLabel[t]).map(t => <FlagBadge key={t} label={flagLabel[t]} />)}
          {showTrip && trip && <span className="muted">{trip.name}</span>}
          {task.task_type && <Chip kind="tt">{task.task_type}</Chip>}
        </div>
        {task.note && noteOpen === null && (
          <div className="note-show" onClick={() => onNote && setNoteOpen('edit')} title="Edit note">“{task.note}”</div>
        )}
      </div>
      {onNote
        ? <button className={'note-btn' + (task.note ? ' has' : '')} title={task.note ? 'Edit note' : 'Add a note'} onClick={() => setNoteOpen(noteOpen ? null : 'edit')}>✎ {task.note ? 'Note' : 'Add note'}</button>
        : <span />}
      <span className={'due due-' + b}>{task.due_date ? fmtDate(task.due_date) : 'No date'}</span>
      <AvatarStack ids={task.assignees} teamById={teamById} />
      <StatusSelect value={task.status} onChange={changeStatus} />
      {onRemove
        ? <button className="remove-btn" title="Remove this task from the trip" aria-label="Remove task"
            onClick={() => window.confirm(`Remove “${task.name}” from this trip?`) && onRemove(task)}>×</button>
        : <span />}
      {noteOpen && <NoteEditor task={task} prompt={noteOpen === 'complete'} onSave={v => onNote(task, v)} onClose={() => setNoteOpen(null)} />}
    </div>
  )
}

// ---------- Status filter (per viewer, remembered in this browser) ----------
const DEFAULT_SHOWN = STATUSES.filter(s => s !== 'Complete')

export function useStatusFilter(key) {
  const storeKey = 'labs.statusFilter.' + key
  const [shown, setShownState] = useState(() => {
    try {
      const v = JSON.parse(localStorage.getItem(storeKey))
      if (Array.isArray(v) && v.every(x => STATUSES.includes(x))) return v
    } catch { /* no storage: use default */ }
    return DEFAULT_SHOWN
  })
  const saveShown = v => {
    setShownState(v)
    try { localStorage.setItem(storeKey, JSON.stringify(v)) } catch { /* fine */ }
  }
  // Rows the user is still working on (e.g. just marked Complete, note box open) stay
  // visible until they're done, even if the filter would hide them.
  const [pinned, setPinned] = useState([])
  const pin = id => setPinned(p => p.includes(id) ? p : [...p, id])
  const unpin = id => setPinned(p => p.filter(x => x !== id))
  return {
    shown, setShown: v => { setPinned([]); saveShown(v) }, pin, unpin,
    apply: list => list.filter(t => shown.includes(t.status) || pinned.includes(t.id)),
  }
}

// Lets a TaskRow keep itself visible while its note box is open.
export const FilterPin = createContext(null)

export function StatusFilter({ filter, tasks }) {
  const { shown, setShown } = filter
  const count = s => tasks.filter(t => t.status === s).length
  const toggle = s => setShown(shown.includes(s) ? shown.filter(x => x !== s) : STATUSES.filter(x => x === s || shown.includes(x)))
  const hidden = tasks.filter(t => !shown.includes(t.status)).length
  const isDefault = shown.length === DEFAULT_SHOWN.length && DEFAULT_SHOWN.every(s => shown.includes(s))
  return (
    <div className="status-filter" role="group" aria-label="Filter by status">
      <span className="muted small">Show</span>
      {STATUSES.map(s => (
        <button key={s} className={'sf-chip st-' + cls(s) + (shown.includes(s) ? ' on' : '')} aria-pressed={shown.includes(s)} onClick={() => toggle(s)}>
          {shown.includes(s) ? '✓ ' : ''}{s} <span className="sf-n">{count(s)}</span>
        </button>
      ))}
      {hidden > 0 && <span className="muted small">{hidden} hidden</span>}
      {!isDefault && <button className="linkbtn subtle" onClick={() => setShown(DEFAULT_SHOWN)}>Reset</button>}
      {shown.length < STATUSES.length && <button className="linkbtn subtle" onClick={() => setShown(STATUSES)}>Show all</button>}
    </div>
  )
}

export function Empty({ children }) {
  return <div className="empty">{children}</div>
}

// Free-text task search: every word must appear in the task name, type, note or trip name.
const fold = x => (x || '').toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
export function textFilter(q, tripById) {
  const words = fold(q).split(/\s+/).filter(Boolean)
  if (!words.length) return list => list
  return list => list.filter(t => {
    const hay = fold([t.name, t.task_type, t.note, tripById[t.trip_id]?.name].join(' '))
    return words.every(w => hay.includes(w))
  })
}
export function SearchBox({ value, onChange }) {
  return (
    <span className="task-search">
      <input type="search" value={value} onChange={e => onChange(e.target.value)} placeholder="Search tasks, e.g. invoice" aria-label="Search tasks"
        onKeyDown={e => { if (e.key === 'Escape') onChange('') }} />
    </span>
  )
}
