import { useContext, useState } from 'react'
import { STATUSES, cls, daysFromToday, fmtDate } from '../lib/format'
import { useSession } from '../lib/session'
import { AvatarStack, Chip, FilterPin, FlagBadge, NoteEditor } from './common'

const STATUS_COLOR = { 'Not Started': '#8b837c', 'In Progress': '#2a78d6', 'Waiting on Client': '#e0961a', Complete: '#0ca30c' }

function dueMeta(t) {
  if (t.status === 'Complete') return { txt: 'Done', kind: 'none' }
  const d = daysFromToday(t.due_date)
  if (d == null) return { txt: 'No date', kind: 'none' }
  if (d < 0) return { txt: `${-d}d overdue`, kind: 'over' }
  if (d === 0) return { txt: 'Due today', kind: 'soon' }
  if (d <= 7) return { txt: `Due in ${d}d`, kind: 'soon' }
  return { txt: fmtDate(t.due_date), kind: 'ok' }
}

function Card({ task, trip, teamById, flagLabel, onStatus, onNote, onRemove, dragging, onDragStart, onDragEnd, noteOpen, setNoteOpen }) {
  const m = dueMeta(task)
  const first = id => teamById[id]?.name.split(' ')[0] ?? ''
  return (
    <div className={'kcard' + (dragging ? ' dragging' : '') + ((task.tags || []).length ? ' flagged' : '')} draggable={!noteOpen}
      onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; onDragStart() }} onDragEnd={onDragEnd}>
      <div className="kt-row">
        <div><div className="kt">{task.name}</div>{trip && <div className="ktrip">{trip.name}</div>}</div>
        {onRemove && <button className="remove-btn" title="Remove this task from the trip" aria-label="Remove task"
          onClick={() => window.confirm(`Remove “${task.name}” from this trip?`) && onRemove(task)}>×</button>}
      </div>
      <div className="kfoot">
        <div className="kleft"><AvatarStack ids={task.assignees} teamById={teamById} /><span className={'kdue ' + m.kind}>{m.txt}</span></div>
        {task.task_type && <Chip kind="tt">{task.task_type}</Chip>}
      </div>
      {(task.tags || []).some(t => flagLabel[t]) && (
        <div className="kfoot start">{(task.tags || []).filter(t => flagLabel[t]).map(t => <FlagBadge key={t} label={flagLabel[t]} />)}</div>
      )}
      {task.note && !noteOpen && <div className="note-show" onClick={() => setNoteOpen('edit')} title="Edit note">“{task.note}”</div>}
      {noteOpen
        ? <NoteEditor task={task} prompt={noteOpen === 'complete'} onSave={v => onNote(task, v)} onClose={() => setNoteOpen(null)} />
        : <div className="kfoot">
            <select className={'movesel st-' + cls(task.status)} value={task.status} onChange={e => onStatus(task, e.target.value)} aria-label="Status">
              {STATUSES.map(s => <option key={s}>{s}</option>)}
            </select>
            {!task.note && <button className="note-btn" onClick={() => setNoteOpen('edit')}>✎ Note</button>}
            <span className="kwho">{task.assignees.length > 1 ? `${task.assignees.length} assigned` : first(task.assignees[0])}</span>
          </div>}
    </div>
  )
}

// Kanban view: one column per status. Cards the status filter hides are left out, but
// every column stays as a drop target (so you can drag a card to Complete).
// Drag a card to another column, or use its status menu, to change status.
export default function TaskBoard({ tasks, statuses = STATUSES, hidden = {}, teamById, tripById, onStatus, onNote, onRemove }) {
  const { tenant } = useSession()
  const pin = useContext(FilterPin)
  const flagLabel = Object.fromEntries((tenant?.settings?.trip_flags || []).map(f => [f.key, f.label]))
  const [dragId, setDragId] = useState(null)
  const [dropCol, setDropCol] = useState(null)
  const [notes, setNotes] = useState({})     // task id -> 'edit' | 'complete'
  const setNoteOpen = (id, v) => {
    setNotes(n => { const x = { ...n }; if (v) x[id] = v; else delete x[id]; return x })
    if (pin) v ? pin.pin(id) : pin.unpin(id)
  }
  const move = (task, s) => {
    if (!task || task.status === s) return
    if (s === 'Complete' && onNote && !task.note) setNoteOpen(task.id, 'complete')
    onStatus(task, s)
  }
  return (
    <div className="kanban">
      {statuses.map(st => {
        const col = tasks.filter(t => t.status === st)
        return (
          <div key={st} className={'kcol' + (dropCol === st ? ' drop' : '')}
            onDragOver={e => { e.preventDefault(); if (dropCol !== st) setDropCol(st) }}
            onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDropCol(c => c === st ? null : c) }}
            onDrop={e => { e.preventDefault(); move(tasks.find(t => t.id === dragId), st); setDragId(null); setDropCol(null) }}>
            <div className="kh"><span className="kdot" style={{ background: STATUS_COLOR[st] }} />{st}<span className="kn">{col.length}</span></div>
            <div className="klist">
              {col.map(t => (
                <Card key={t.id} task={t} trip={tripById?.[t.trip_id]} teamById={teamById} flagLabel={flagLabel} onStatus={move} onNote={onNote} onRemove={onRemove}
                  dragging={dragId === t.id} onDragStart={() => setDragId(t.id)} onDragEnd={() => { setDragId(null); setDropCol(null) }}
                  noteOpen={notes[t.id]} setNoteOpen={v => setNoteOpen(t.id, v)} />
              ))}
              {col.length === 0 && <div className="kempty">Drop here{hidden[st] ? <><br /><span className="small">{hidden[st]} hidden by the filter</span></> : null}</div>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// List / Board switch, remembered per view in this browser.
export function useTaskLayout(key, initial = 'board') {
  const storeKey = 'labs.taskLayout.' + key
  const [v, setV] = useState(() => { try { return localStorage.getItem(storeKey) || initial } catch { return initial } })
  return [v, x => { setV(x); try { localStorage.setItem(storeKey, x) } catch { /* fine */ } }]
}

export function LayoutToggle({ value, onChange }) {
  return (
    <div className="seg" role="group" aria-label="Show tasks as">
      <button className={value === 'list' ? 'on' : ''} aria-pressed={value === 'list'} onClick={() => onChange('list')}>☰ List</button>
      <button className={value === 'board' ? 'on' : ''} aria-pressed={value === 'board'} onClick={() => onChange('board')}>▦ Board</button>
    </div>
  )
}
