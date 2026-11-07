import { useState } from 'react'
import { useSession } from '../lib/session'
import { deletePerson, savePerson } from '../lib/data'
import { Avatar } from './common'

const COLORS = ['#9c3d54', '#2a78d6', '#2a9d9d', '#c26b2a', '#5a4bb0', '#3f8f4a', '#b8860b', '#8b837c']

const FIELDS = {
  team_members: [['name', 'Name'], ['role_title', 'Role'], ['phone', 'Phone'], ['email', 'Email']],
  guides: [['name', 'Name'], ['phone', 'Phone'], ['email', 'Email']],
}

function PersonForm({ table, person, team, onSave, onCancel, busy }) {
  const [p, setP] = useState({ color: COLORS[0], active: true, ...person })
  const set = k => e => setP(v => ({ ...v, [k]: e.target.value }))
  return (
    <form className="ppl-form" onSubmit={e => { e.preventDefault(); if (p.name?.trim()) onSave(p) }}>
      {FIELDS[table].map(([k, label]) => (
        <label key={k}>{label}<input value={p[k] || ''} onChange={set(k)} required={k === 'name'} autoFocus={k === 'name'}
          type={k === 'email' ? 'email' : 'text'} maxLength={k === 'phone' ? 80 : 120}
          placeholder={k === 'phone' ? '+39 … / +1 …' : k === 'role_title' ? 'e.g. Travel Specialist' : ''} /></label>
      ))}
      {table === 'guides' && (
        <label>Also on the office team<select value={p.team_member_id || ''} onChange={set('team_member_id')}>
          <option value="">No</option>{team.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
      )}
      <div className="ppl-colors" role="radiogroup" aria-label="Color">
        <span className="muted small">Color</span>
        {COLORS.map(c => <button type="button" key={c} role="radio" aria-checked={p.color === c} aria-label={c}
          className={'ppl-color' + (p.color === c ? ' on' : '')} style={{ background: c }} onClick={() => setP(v => ({ ...v, color: c }))} />)}
      </div>
      <div className="ppl-form-f">
        <button type="button" className="btn ghost sm" onClick={onCancel}>Cancel</button>
        <button className="btn sm" disabled={busy || !p.name?.trim()}>{person.id ? 'Save' : 'Add'}</button>
      </div>
    </form>
  )
}

function PeopleCard({ title, hint, table, people, team, usage, tenantId, reload }) {
  const [edit, setEdit] = useState(null)      // person being edited, or {} for new
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [showOff, setShowOff] = useState(false)
  const run = async fn => {
    setBusy(true); setErr(null)
    try { await fn(); await reload(); setEdit(null) } catch (x) {
      setErr(/phone/.test(x.message) && /column/.test(x.message) ? 'Phone numbers need setup step 12 run in Supabase first.' : x.message)
    } finally { setBusy(false) }
  }
  const off = people.filter(p => !p.active)
  const list = showOff ? people : people.filter(p => p.active)
  const del = p => {
    const used = usage(p)
    if (used) { setErr(`${p.name} is still ${used}. Turn them off instead: they stay on past work but leave the pick lists.`); return }
    if (window.confirm(`Delete ${p.name}? This can't be undone.`)) run(() => deletePerson(table, tenantId, p.id))
  }
  return (
    <div className="card">
      <div className="card-h"><h2>{title}</h2><span className="muted small">{hint}</span><span className="push" />
        {!edit && <button className="btn sm" onClick={() => setEdit({})}>+ Add</button>}</div>
      {err && <p className="err">{err}</p>}
      {edit && !edit.id && <PersonForm table={table} person={{}} team={team} busy={busy} onCancel={() => setEdit(null)} onSave={p => run(() => savePerson(table, tenantId, p))} />}
      <div className="ppl-list">
        {list.map(p => edit?.id === p.id
          ? <PersonForm key={p.id} table={table} person={p} team={team} busy={busy} onCancel={() => setEdit(null)} onSave={x => run(() => savePerson(table, tenantId, x))} />
          : (
            <div key={p.id} className={'ppl-row' + (p.active ? '' : ' off')}>
              <Avatar member={p} />
              <div className="ppl-main">
                <div className="ppl-name">{p.name}{p.role_title && <span className="muted small"> · {p.role_title}</span>}{!p.active && <span className="chip">Off</span>}</div>
                <div className="ppl-contact">
                  {p.phone ? <a href={'tel:' + p.phone.split('/')[0].replace(/[^\d+]/g, '')}>{p.phone}</a> : <span className="muted">No phone</span>}
                  {p.email && <a href={'mailto:' + p.email}>{p.email}</a>}
                </div>
              </div>
              <div className="ppl-acts">
                <button className="linkbtn subtle" disabled={busy} onClick={() => { setErr(null); setEdit(p) }}>Edit</button>
                <button className="linkbtn subtle" disabled={busy} onClick={() => run(() => savePerson(table, tenantId, { id: p.id, active: !p.active }))}>{p.active ? 'Turn off' : 'Turn on'}</button>
                <button className="linkbtn subtle danger-txt" disabled={busy} onClick={() => del(p)}>Delete</button>
              </div>
            </div>
          ))}
        {!list.length && <p className="muted small">Nobody here yet.</p>}
      </div>
      {off.length > 0 && <button className="linkbtn subtle ppl-toggle" onClick={() => setShowOff(v => !v)}>{showOff ? 'Hide' : 'Show'} {off.length} turned off</button>}
    </div>
  )
}

// Admin: the office team and the field guides, with the phone numbers the Guide Note prints.
export default function TeamAdmin({ team, guides, trips, tasks, reload }) {
  const { tenant } = useSession()
  const teamUsage = m => {
    const n = tasks.filter(t => t.assignees.includes(m.id)).length
    const l = trips.filter(t => t.lead_id === m.id).length
    return n ? `assigned to ${n} task${n === 1 ? '' : 's'}` : l ? `travel specialist on ${l} trip${l === 1 ? '' : 's'}` : null
  }
  const guideUsage = g => {
    const l = trips.filter(t => t.details?.tour_leader_id === g.id).length
    return l ? `tour leader on ${l} trip${l === 1 ? '' : 's'}` : null
  }
  return (
    <div className="view">
      <div className="card intro"><b>Team & guides</b>: names, phones and emails here appear on the Guide Note and in every pick list. Turning someone off keeps them on past trips and tasks but takes them out of the lists.</div>
      <PeopleCard title="Office team" hint="Travel specialists, trip managers, confirmations" table="team_members" people={team} team={team}
        usage={teamUsage} tenantId={tenant.id} reload={reload} />
      <PeopleCard title="Guides" hint="Field guides and tour leaders" table="guides" people={guides} team={team.filter(m => m.active)}
        usage={guideUsage} tenantId={tenant.id} reload={reload} />
    </div>
  )
}
