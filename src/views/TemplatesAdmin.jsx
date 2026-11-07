import { useMemo, useState } from 'react'
import { useSession } from '../lib/session'
import { addListItem, deleteTemplate, removeListItem, renameListItem, saveTemplate, setTemplateFields, useTemplates } from '../lib/admin'
import { dueRuleText } from '../lib/format'
import { Chip, Empty } from './common'
import TemplateModal from './TemplateModal'

const SYSTEMS = [
  { key: 'sales', list: 'sales_stages', label: 'Sales stages', hint: 'Tasks are added when a trip enters the stage.' },
  { key: 'trip', list: 'trip_stages', label: 'Trip stages', hint: 'Tasks are added when the trip is created and wait in the queue until the trip reaches the stage.' },
]

// Inline "name" editor used for adding/renaming buckets and trip types.
function NameForm({ initial = '', placeholder, submitLabel, onSubmit, onCancel }) {
  const [v, setV] = useState(initial)
  return (
    <form className="name-form" onSubmit={e => { e.preventDefault(); if (v.trim()) onSubmit(v.trim()) }}>
      <input autoFocus value={v} placeholder={placeholder} onChange={e => setV(e.target.value)} />
      <button className="btn">{submitLabel}</button>
      <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
    </form>
  )
}

export default function TemplatesAdmin({ team }) {
  const { tenant, refreshTenant } = useSession()
  const settings = tenant.settings || {}
  const tripTypes = settings.trip_types || []
  const { loading, error, templates, reload } = useTemplates(tenant.id)
  const [sys, setSys] = useState('sales')
  const [typeFilter, setTypeFilter] = useState('All')
  const [editing, setEditing] = useState(null)       // template object (new or existing)
  const [nameEdit, setNameEdit] = useState(null)     // { list, old } | { list, adding: true }
  const [err, setErr] = useState(null)
  const flags = settings.trip_flags || []
  // Each trip flag (e.g. Heritage) gets its own tab with a single bucket.
  const systems = [...SYSTEMS, ...flags.map(f => ({ key: 'flag:' + f.key, flag: f, label: f.label,
    hint: `Tasks are added the moment a trip's ${f.label} box is ticked (or a trip is created with it ticked).` }))]
  const system = systems.find(s => s.key === sys) ?? systems[0]
  const isFlag = Boolean(system.flag)
  const stSystem = isFlag ? 'flag' : system.key
  const stages = isFlag ? [system.flag.key] : settings[system.list] || []
  const stageLabel = st => isFlag ? system.flag.label : st
  const teamById = useMemo(() => Object.fromEntries(team.map(m => [m.id, m])), [team])

  const run = async fn => {
    setErr(null)
    try { await fn(); await reload() } catch (e) { setErr(e.message) }
  }
  const runList = fn => run(async () => { await fn(); refreshTenant(); setNameEdit(null) })

  const inBucket = st => templates
    .filter(t => t.stage_system === stSystem && t.stage === st)
    .filter(t => typeFilter === 'All' || t.trip_types.length === 0 || t.trip_types.includes(typeFilter))
  const orphaned = templates.filter(t => t.stage_system === stSystem && !stages.includes(t.stage))

  const move = (list, i, dir) => run(async () => {
    const a = list[i], b = list[i + dir]
    if (!b) return
    // Normalise positions so swapping always works, even if they were equal.
    await Promise.all(list.map((t, ix) => t.position === ix ? null : setTemplateFields(tenant.id, t.id, { position: ix })))
    await setTemplateFields(tenant.id, a.id, { position: i + dir })
    await setTemplateFields(tenant.id, b.id, { position: i })
  })

  const newTemplate = stage => {
    const max = Math.max(-1, ...templates.filter(t => t.stage_system === stSystem && t.stage === stage).map(t => t.position))
    setEditing({
      stage_system: stSystem, stage, name: '', description: '', task_type: '', trip_types: typeFilter === 'All' ? [] : [typeFilter],
      due_anchor: sys === 'trip' ? 'trip_start' : 'stage_entered', due_offset_days: sys === 'trip' ? -30 : 3,
      default_member_id: null, reminder_offsets: [1], active: true, position: max + 1,
    })
  }

  return (
    <div className="view">
      <div className="card intro">
        <b>Task templates</b> are the checklists that build themselves on each trip. Pick the stage a task belongs to and which trip
        types get it. Changes apply to trips from now on: trips that already passed a stage keep the tasks they have.
      </div>

      <div className="toolbar">
        <div className="seg">
          {systems.map(s => <button key={s.key} className={sys === s.key ? 'on' : ''} onClick={() => { setSys(s.key); setNameEdit(null) }}>{s.label}</button>)}
        </div>
        <div className="seg">
          {['All', ...tripTypes].map(t => <button key={t} className={typeFilter === t ? 'on' : ''} onClick={() => setTypeFilter(t)}>{t}</button>)}
        </div>
      </div>
      <p className="muted small" style={{ margin: 0 }}>{system.hint}{typeFilter !== 'All' && ` Showing what a ${typeFilter} trip gets.`}</p>
      {(err || error) && <p className="err">{err || error}</p>}
      {loading && <Empty>Loading…</Empty>}

      {!loading && stages.map((st, si) => {
        const list = inBucket(st)
        const renaming = !isFlag && nameEdit?.list === system.list && nameEdit?.old === st
        return (
          <div className="card bucket" key={st}>
            <div className="card-h">
              {renaming
                ? <NameForm initial={st} submitLabel="Rename" onCancel={() => setNameEdit(null)}
                    onSubmit={v => runList(() => renameListItem(tenant.id, system.list, st, v))} />
                : <>
                    {isFlag ? <span className="bucket-ix flag">✦</span> : <span className="bucket-ix">{si + 1}</span>}<h2>{stageLabel(st)}</h2>
                    <span className="muted small">{list.length} task{list.length === 1 ? '' : 's'}</span>
                    <span className="push" />
                    {!isFlag && <button className="linkbtn" onClick={() => setNameEdit({ list: system.list, old: st })}>Rename</button>}
                    {!isFlag && (sys === 'sales' || si === stages.length - 1) &&
                      <button className="linkbtn subtle" onClick={() => window.confirm(`Remove the “${st}” stage? Only works if no trips or templates use it.`) &&
                        runList(() => removeListItem(tenant.id, system.list, st))}>Remove</button>}
                  </>}
            </div>
            {list.length === 0 && <Empty>No tasks in this stage{typeFilter !== 'All' ? ` for ${typeFilter}` : ''}.</Empty>}
            {list.map((t, i) => (
              <div className={'tpl-row' + (t.active ? '' : ' off')} key={t.id}>
                <div className="tpl-order">
                  <button title="Move up" disabled={i === 0} onClick={() => move(list, i, -1)}>▲</button>
                  <button title="Move down" disabled={i === list.length - 1} onClick={() => move(list, i, 1)}>▼</button>
                </div>
                <div className="task-main" onClick={() => setEditing(t)} role="button">
                  <div className="task-name">{t.name}{!t.active && <span className="muted small"> · off</span>}</div>
                  <div className="task-meta">
                    {t.task_type && <Chip kind="tt">{t.task_type}</Chip>}
                    {t.trip_types.length === 0 ? <span className="muted">All trip types</span> : t.trip_types.map(x => <Chip key={x} kind="type">{x}</Chip>)}
                    <span className="muted">· {dueRuleText(t)}</span>
                    <span className="muted">· {t.default_member_id ? teamById[t.default_member_id]?.name ?? 'Someone' : 'Trip lead'}</span>
                  </div>
                </div>
                <label className="switch" title={t.active ? 'On — will be added to trips' : 'Off — kept but not added'}>
                  <input type="checkbox" checked={t.active} onChange={e => run(() => setTemplateFields(tenant.id, t.id, { active: e.target.checked }))} />
                  <span>{t.active ? 'On' : 'Off'}</span>
                </label>
                <button className="linkbtn" onClick={() => setEditing(t)}>Edit</button>
              </div>
            ))}
            <button className="linkbtn add" onClick={() => newTemplate(st)}>+ Add task to {stageLabel(st)}</button>
          </div>
        )
      })}

      {orphaned.length > 0 && (
        <div className="card bucket">
          <div className="card-h"><h2>Not in any stage</h2><span className="muted small">These won't be added until you move them to a stage.</span></div>
          {orphaned.map(t => <div className="tpl-row" key={t.id}><div className="task-main" onClick={() => setEditing(t)} role="button"><div className="task-name">{t.name}</div><div className="task-meta muted">was “{t.stage}”</div></div><button className="linkbtn" onClick={() => setEditing(t)}>Edit</button></div>)}
        </div>
      )}

      {!loading && !isFlag && (nameEdit?.list === system.list && nameEdit.adding
        ? <div className="card"><NameForm placeholder={sys === 'sales' ? 'New sales stage, e.g. Deposit Pending' : 'New trip stage, e.g. Post-Trip'} submitLabel="Add stage"
            onCancel={() => setNameEdit(null)} onSubmit={v => runList(() => addListItem(tenant.id, system.list, v))} /></div>
        : <button className="btn ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setNameEdit({ list: system.list, adding: true })}>+ New {sys === 'sales' ? 'sales' : 'trip'} stage</button>)}

      <div className="card">
        <div className="card-h"><h2>Trip types</h2><span className="muted small">Each template can apply to all or some of these.</span></div>
        <div className="type-list">
          {tripTypes.map(t => nameEdit?.list === 'trip_types' && nameEdit.old === t
            ? <NameForm key={t} initial={t} submitLabel="Rename" onCancel={() => setNameEdit(null)} onSubmit={v => runList(() => renameListItem(tenant.id, 'trip_types', t, v))} />
            : <span key={t} className="type-item"><Chip kind="type">{t}</Chip>
                <button className="linkbtn" onClick={() => setNameEdit({ list: 'trip_types', old: t })}>Rename</button>
                <button className="linkbtn subtle" onClick={() => window.confirm(`Remove the “${t}” trip type? Only works if no trips use it.`) && runList(() => removeListItem(tenant.id, 'trip_types', t))}>Remove</button>
              </span>)}
        </div>
        {nameEdit?.list === 'trip_types' && nameEdit.adding
          ? <NameForm placeholder="New trip type" submitLabel="Add type" onCancel={() => setNameEdit(null)} onSubmit={v => runList(() => addListItem(tenant.id, 'trip_types', v))} />
          : <button className="linkbtn add" onClick={() => setNameEdit({ list: 'trip_types', adding: true })}>+ Add trip type</button>}
      </div>

      {editing && <TemplateModal template={editing} settings={settings} team={team} flags={flags}
        onClose={() => setEditing(null)}
        onSave={t => run(async () => { await saveTemplate(tenant.id, t); setEditing(null) })}
        onDelete={editing.id ? () => window.confirm(`Delete the “${editing.name}” template? Tasks already on trips stay.`) &&
          run(async () => { await deleteTemplate(tenant.id, editing.id); setEditing(null) }) : null} />}
    </div>
  )
}
