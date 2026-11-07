import { useMemo, useState } from 'react'
import { fmtRange, daysFromToday } from '../lib/format'
import { Avatar, Chip, Empty } from './common'
import NewTripModal from './NewTripModal'

export default function TripsView({ tenant, trips, tasks, teamById, openTrip, reload, guides }) {
  const settings = tenant.settings || {}
  const stages = settings.sales_stages || []
  const types = settings.trip_types || []
  const [mode, setMode] = useState('pipeline')
  const [type, setType] = useState('All')
  const [q, setQ] = useState('')
  const [creating, setCreating] = useState(false)

  const openCount = useMemo(() => {
    const c = {}
    for (const t of tasks) if (t.status !== 'Complete' && t.trip_id) c[t.trip_id] = (c[t.trip_id] || 0) + 1
    return c
  }, [tasks])

  const shown = trips.filter(t => (type === 'All' || t.trip_type === type) && t.name.toLowerCase().includes(q.toLowerCase()))

  const card = t => {
    const n = daysFromToday(t.start_date)
    return (
      <div key={t.id} className="trip-card" onClick={() => openTrip(t.id)}>
        <div className="trip-card-h">
          <div className="trip-name">{t.name}{(settings.trip_flags || []).filter(f => t.details?.[f.key]).map(f => <span key={f.key} className="flag-mark" title={f.label}> ✦</span>)}</div>
          <Avatar member={teamById[t.lead_id]} sm />
        </div>
        <div className="muted small">{fmtRange(t.start_date, t.end_date)}{n != null && n >= 0 ? ` · ${n} days out` : ''}</div>
        <div className="trip-card-f">
          {t.trip_type && <Chip kind="type">{t.trip_type}</Chip>}
          {mode === 'grid' && t.sales_stage && <Chip kind="stage">{t.sales_stage}</Chip>}
          <span className="muted small push">{openCount[t.id] || 0} open tasks</span>
        </div>
      </div>
    )
  }

  return (
    <div className="view">
      <div className="toolbar">
        <div className="seg">
          <button className={mode === 'pipeline' ? 'on' : ''} onClick={() => setMode('pipeline')}>Pipeline</button>
          <button className={mode === 'grid' ? 'on' : ''} onClick={() => setMode('grid')}>Cards</button>
        </div>
        <div className="seg">
          {['All', ...types].map(t => <button key={t} className={type === t ? 'on' : ''} onClick={() => setType(t)}>{t}</button>)}
        </div>
        <input className="search" placeholder="Search trips" value={q} onChange={e => setQ(e.target.value)} />
        <button className="btn push" onClick={() => setCreating(true)}>+ New trip</button>
      </div>
      {!trips.length && <Empty>No trips yet. Create the first one with “+ New trip”.</Empty>}
      {mode === 'pipeline' ? (
        <div className="pipeline">
          {[...stages, ...(shown.some(t => !stages.includes(t.sales_stage)) ? ['(No stage)'] : [])].map(s => {
            const col = shown.filter(t => (stages.includes(t.sales_stage) ? t.sales_stage : '(No stage)') === s)
            return (
              <div className="pipe-col" key={s}>
                <div className="pipe-h"><Chip kind="stage">{s}</Chip><span className="muted small">{col.length}</span></div>
                {col.map(card)}
              </div>
            )
          })}
        </div>
      ) : <div className="grid">{shown.map(card)}</div>}
      {creating && <NewTripModal tenant={tenant} teamById={teamById} guides={guides} onClose={() => setCreating(false)}
        onCreated={id => { setCreating(false); reload().then(() => openTrip(id)) }} />}
    </div>
  )
}
