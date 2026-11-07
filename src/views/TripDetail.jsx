import { Fragment, useState } from 'react'
import { createTask, deleteTrip, isQueued, removeTask, setSalesStage, setTripStage } from '../lib/data'
import { cls, daysFromToday, fmtRange } from '../lib/format'
import { useSession } from '../lib/session'
import { GiftGlyph, WineGlyph } from './Icon'
import TripDrawer from './TripDrawer'
import GuideSchedule from './GuideSchedule'
import GuideNoteCard from './GuideNote'
import TaskBoard, { LayoutToggle, useTaskLayout } from './TaskBoard'
import { STATUSES } from '../lib/format'
import { Avatar, Chip, Empty, FilterPin, StatusFilter, TaskRow, useStatusFilter } from './common'

export default function TripDetail({ tenant, trip, tasks, teamById, tripById, guides = [], onStatus, onNote, back, reload }) {
  const s = tenant.settings || {}
  const stages = s.trip_stages || []
  const [name, setName] = useState('')
  const [who, setWho] = useState('')
  const [due, setDue] = useState('')
  const [err, setErr] = useState(null)
  const [editing, setEditing] = useState(false)
  const d = trip.details || {}
  const leader = guides.find(g => g.id === d.tour_leader_id)
  const pax = d.pax_min && d.pax_max && d.pax_min !== d.pax_max ? `${d.pax_min}–${d.pax_max} pax` : (d.pax_max || d.pax_min) ? `${d.pax_max || d.pax_min} pax` : null
  const LINKS = [['client_file', 'Client file'], ['nivo', 'Nivo'], ['budget', 'Budget'], ['heritage_folder', 'Heritage folder']]
  const linkUrl = k => k === 'heritage_folder' ? d.heritage_folder?.url : d.links?.[k]

  const mine = tasks.filter(t => t.trip_id === trip.id)
  const active = mine.filter(t => !isQueued(t, tripById))
  const filter = useStatusFilter('trip')
  const [layout, setLayout] = useTaskLayout('trip')
  const visible = filter.apply(active)
  const queued = mine.filter(t => isQueued(t, tripById))
  const doneN = active.filter(t => t.status === 'Complete').length
  const { hasModule } = useSession()
  const g = d.gift
  const gift = g && g.kind && g.kind !== 'NA'
    ? { kind: g.kind, cls: g.kind === 'MBV' ? 'mbv' : 'nonmbv', title: (g.kind === 'MBV' ? 'MBV gift' : 'Non-MBV gift') + (g.location ? ` · ${g.location}` : '') + (g.rooms ? ` · ${g.rooms} room${g.rooms === 1 ? '' : 's'}` : '') }
    : null
  const out = daysFromToday(trip.start_date), back2 = daysFromToday(trip.end_date ?? trip.start_date)
  const when = out == null ? null
    : out <= 0 && back2 >= 0 ? { text: 'on the ground', cls: 'ground' }
    : out > 0 ? { text: `${out} day${out === 1 ? '' : 's'} out`, cls: out < 30 ? 'soon' : '' }
    : { text: 'returned', cls: '' }

  const run = async fn => { setErr(null); try { await fn(); await reload() } catch (e) { setErr(e.message) } }
  const remove = async () => {
    const n = mine.length
    const msg = `Delete “${trip.name}”${n ? ` and its ${n} task${n === 1 ? '' : 's'}` : ''}? This can't be undone.`
    if (!window.confirm(msg)) return
    setErr(null)
    try { await deleteTrip(tenant.id, trip.id); back(); await reload() } catch (e) { setErr(e.message) }
  }
  const remove1 = task => run(() => removeTask(tenant.id, task))
  const add = e => {
    e.preventDefault()
    if (!name.trim()) return
    run(async () => { await createTask(tenant.id, { tripId: trip.id, name: name.trim(), dueDate: due, assignees: who ? [who] : [] }); setName(''); setDue('') })
  }

  return (
    <div className="view">
      <button className="linkbtn" onClick={back}>‹ All trips</button>
      <div className="card trip-head">
        {hasModule('gifts') && gift && (
          <button className={'gift-mark ' + gift.cls} onClick={() => setEditing(true)} title={gift.title} aria-label={gift.title}>
            {gift.kind === 'NonMBV' ? <WineGlyph /> : <GiftGlyph />}
          </button>
        )}
        <div className="trip-title">
          <h1>{trip.name}</h1>
          {(s.trip_flags || []).filter(f => d[f.key]).map(f => <span key={f.key} className="flag-title">✦ {f.label}</span>)}
          <button className="btn ghost sm" onClick={() => setEditing(true)}>✎ Edit trip details</button>
        </div>
        <div className="metarow">
          <select className={'chip stage-pill stage-' + cls(trip.sales_stage)} value={trip.sales_stage || ''} title="Sales stage: moving it adds that stage's checklist"
            onChange={e => run(() => setSalesStage(tenant.id, trip.id, e.target.value))}>
            {!trip.sales_stage && <option value="">—</option>}
            {(s.sales_stages || []).map(st => <option key={st}>{st}</option>)}
          </select>
          {trip.trip_type && <Chip kind="type">{trip.trip_type}</Chip>}
          {(d.destinations || []).map(x => <span key={x} className="chip dest">{x}</span>)}
          <span className="meta-txt">{fmtRange(trip.start_date, trip.end_date)}</span>
          {when && <span className={'meta-when ' + when.cls}>· {when.text}</span>}
          {teamById[trip.lead_id] && <span className="meta-txt lead" title="Travel specialist"><Avatar member={teamById[trip.lead_id]} sm /> {teamById[trip.lead_id].name.split(' ')[0]}{pax ? ` · ${pax}` : ''}</span>}
          {!teamById[trip.lead_id] && pax && <span className="meta-txt">{pax}</span>}
          {leader && <span className="meta-txt lead" title="Tour leader"><Avatar member={leader} sm /> {leader.name} <span className="muted small">(tour leader)</span></span>}
        </div>
        {(d.tour_name || LINKS.some(([k]) => linkUrl(k))) && (
          <div className="metarow sub">
            {d.tour_name && <span className="meta-txt">{d.tour_name}</span>}
            {LINKS.filter(([k]) => linkUrl(k)).map(([k, label]) => <a key={k} className="ext-link" href={linkUrl(k)} target="_blank" rel="noreferrer">{label} ↗</a>)}
          </div>
        )}
        {d.notes && <p className="trip-notes">{d.notes}</p>}
        {stages.length > 0 && (
          <div className="tpipe" role="list" aria-label="Trip stage">
            {stages.map((st, i) => (
              <Fragment key={st}>
                {i > 0 && <div className={'tpipe-line' + (i <= trip.trip_stage ? ' on' : '')} />}
                <button role="listitem" className={'tpipe-step' + (i < trip.trip_stage ? ' done' : '') + (i === trip.trip_stage ? ' active' : '')}
                  onClick={() => run(() => setTripStage(tenant.id, trip.id, i))} title={`Set trip stage: ${st}`}>
                  <span className="tpipe-dot">{i < trip.trip_stage ? '✓' : ''}</span>
                  <span className="tpipe-lbl">{st}</span>
                </button>
              </Fragment>
            ))}
          </div>
        )}
        <div className="dprog">
          <div className="ptrack"><div className="pfill" style={{ width: (active.length ? doneN / active.length * 100 : 0) + '%' }} /></div>
          <span>{doneN}/{active.length} done{queued.length ? ` · ${queued.length} queued` : ''}</span>
        </div>
      </div>

      {hasModule('guide_schedule') && <GuideSchedule key={trip.id} tenant={tenant} trip={trip} guides={guides} onEditTrip={() => setEditing(true)} />}
      {hasModule('guide_note') && <GuideNoteCard key={'gn' + trip.id} tenant={tenant} trip={trip} teamById={teamById} guides={guides} reload={reload} />}

      <div className="card">
        <div className="card-h"><h2>Tasks</h2><span className="muted small">{active.filter(t => t.status !== 'Complete').length} open</span></div>
        <form className="quick-add" onSubmit={add}>
          <input placeholder="Add a task…" value={name} onChange={e => setName(e.target.value)} />
          <select value={who} onChange={e => setWho(e.target.value)}><option value="">Unassigned</option>
            {Object.values(teamById).filter(m => m.active).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
          <input type="date" value={due} onChange={e => setDue(e.target.value)} />
          <button className="btn">Add</button>
        </form>
        {err && <p className="err">{err}</p>}
        <div className="task-tools">
          <StatusFilter filter={filter} tasks={active} />
          <LayoutToggle value={layout} onChange={setLayout} />
        </div>
        <FilterPin.Provider value={filter}>
        {layout === 'board'
          ? <TaskBoard tasks={visible} hidden={Object.fromEntries(STATUSES.map(st => [st, active.filter(t => t.status === st).length - visible.filter(t => t.status === st).length]))}
              teamById={teamById} onStatus={onStatus} onNote={onNote} onRemove={remove1} />
          : visible.length ? visible.map(t => <TaskRow key={t.id} task={t} teamById={teamById} onStatus={onStatus} onNote={onNote} onRemove={remove1} showTrip={false} />)
          : <Empty>{active.length ? 'No tasks match this filter.' : 'No active tasks on this trip.'}</Empty>}
        </FilterPin.Provider>
        {queued.length > 0 && (
          <details className="queue">
            <summary>Tasks in queue ({queued.length}) — released when the trip reaches their stage</summary>
            {queued.map(t => (
              <div key={t.id} className="queue-row">
                <span>{t.name}</span><span className="queue-r"><span className="muted small">at “{stages[t.gate] ?? `stage ${t.gate + 1}`}”</span>
                  <button className="remove-btn" title="Remove this task from the trip" aria-label="Remove task"
                    onClick={() => window.confirm(`Remove “${t.name}” from this trip?`) && remove1(t)}>×</button></span>
              </div>
            ))}
          </details>
        )}
      </div>
      {editing && <TripDrawer tenant={tenant} trip={trip} teamById={teamById} guides={guides} onClose={() => setEditing(false)} onSaved={reload} />}
      <div className="danger-zone">
        <button className="btn danger" onClick={remove}>Delete trip</button>
        <span className="muted small">Removes the trip and all of its tasks.</span>
      </div>
    </div>
  )
}
