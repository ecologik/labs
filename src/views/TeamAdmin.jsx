import { useCallback, useEffect, useState } from 'react'
import { useSession } from '../lib/session'
import { deletePerson, savePerson } from '../lib/data'
import { invitePerson, listAccess, revokeAccess } from '../lib/admin'
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

const ROLE_LABEL = { staff: 'Staff', admin: 'Admin', guide: 'Guide' }

// One person's login: signed in, invited (waiting), or an "Invite to Labs" button.
function AccessLine({ table, person, access, tenantId, reloadAccess }) {
  const isTeam = table === 'team_members'
  const [form, setForm] = useState(null)   // { email, role } while inviting / changing role
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [note, setNote] = useState(null)
  if (!access) return null
  if (!isTeam && person.team_member_id) return <div className="ppl-access"><span className="muted">Logs in through the office team</span></div>
  const mine = access.filter(a => (isTeam ? a.team_member_id === person.id : a.guide_id === person.id))
  const login = mine.find(a => a.kind === 'login')
  const invite = mine.find(a => a.kind === 'invite')
  const run = async (fn, msg) => {
    setBusy(true); setErr(null); setNote(null)
    try { const r = await fn(); await reloadAccess(); setForm(null); setNote(typeof msg === 'function' ? msg(r) : msg) }
    catch (x) { setErr(/admin_invite|function/.test(x.message) ? 'Logins need setup step 14 run in Supabase first.' : x.message) }
    finally { setBusy(false) }
  }
  const send = e => {
    e.preventDefault()
    run(() => invitePerson(tenantId, { email: form.email, role: isTeam ? form.role : 'guide', teamMemberId: isTeam ? person.id : null, guideId: isTeam ? null : person.id }),
      r => r === 'granted' ? `${person.name} already had a Google login, so they're in now.` : r === 'updated' ? 'Role changed.'
        : `Invited. Tell ${person.name.split(' ')[0]} to go to labs.ecologik.net and sign in with Google as ${form.email.trim().toLowerCase()}.`)
  }
  const startForm = () => { setErr(null); setNote(null); setForm({ email: invite?.email || person.email || '', role: login?.role || invite?.role || 'staff' }) }
  return (
    <div className="ppl-access">
      {login && <><span className="acc-chip on">✓ Logs in · {ROLE_LABEL[login.role]}</span><span className="muted">{login.email}{login.is_me ? ' (you)' : ''}</span></>}
      {!login && invite && <><span className="acc-chip wait">Invited · {ROLE_LABEL[invite.role]}</span><span className="muted">{invite.email}, waiting for first sign-in</span></>}
      {!login && !invite && !form && <span className="acc-chip">No login</span>}
      {!form && (
        <>
          {!login && !invite && <button className="linkbtn" disabled={busy} onClick={startForm}>Invite to Labs</button>}
          {!login && invite && <button className="linkbtn subtle" disabled={busy} onClick={startForm}>Change</button>}
          {!login && invite && <button className="linkbtn subtle" disabled={busy} onClick={() => run(() => revokeAccess(tenantId, 'invite', invite.id), 'Invite cancelled.')}>Cancel invite</button>}
          {login && isTeam && !login.is_me && <button className="linkbtn subtle" disabled={busy} onClick={startForm}>Change role</button>}
          {login && !login.is_me && <button className="linkbtn subtle danger-txt" disabled={busy}
            onClick={() => window.confirm(`Remove ${person.name}'s login? They stay on trips and tasks but can't sign in until invited again.`) && run(() => revokeAccess(tenantId, 'login', login.id), 'Login removed.')}>Remove login</button>}
        </>
      )}
      {form && (
        <form className="acc-form" onSubmit={send}>
          {!login && <label>Google email they sign in with<input type="email" required autoFocus value={form.email} placeholder="name@mybellavita.com"
            onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></label>}
          {isTeam
            ? <label>Role<select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
                <option value="staff">Staff: trips and tasks</option><option value="admin">Admin: also settings and logins</option></select></label>
            : <span className="muted small">Guides get view-only access.</span>}
          <button type="button" className="btn ghost sm" onClick={() => setForm(null)}>Cancel</button>
          <button className="btn sm" disabled={busy || (!login && !form.email.trim())}>{login ? 'Save' : invite ? 'Update invite' : 'Invite'}</button>
          {!login && <p className="muted small hint">No email is sent. Once they sign in with this Google account, they're linked to {person.name}{isTeam ? ' and see their own trips and tasks' : ''}.</p>}
        </form>
      )}
      {err && <span className="err">{err}</span>}
      {note && <span className="muted">{note}</span>}
    </div>
  )
}

function PeopleCard({ title, hint, table, people, team, usage, tenantId, reload, access, reloadAccess }) {
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
                <AccessLine table={table} person={p} access={access} tenantId={tenantId} reloadAccess={reloadAccess} />
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
  const [access, setAccess] = useState(null)
  const [accessErr, setAccessErr] = useState(null)
  const reloadAccess = useCallback(() => listAccess(tenant.id).then(r => { setAccess(r || []); setAccessErr(null) })
    .catch(e => setAccessErr(/admin_access_list|function/.test(e.message) ? 'To invite people to log in, run setup step 14 in Supabase first.' : e.message)), [tenant.id])
  useEffect(() => { reloadAccess() }, [reloadAccess])
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
      <div className="card intro"><b>Team & guides</b>: names, phones and emails here appear on the Guide Note and in every pick list. Turning someone off keeps them on past trips and tasks but takes them out of the lists. <b>Invite to Labs</b> lets a person sign in with Google; their login is linked to them, so they see their own trips and tasks.</div>
      {accessErr && <p className="err">{accessErr}</p>}
      <PeopleCard title="Office team" hint="Travel specialists, trip managers, confirmations" table="team_members" people={team} team={team}
        usage={teamUsage} tenantId={tenant.id} reload={reload} access={access} reloadAccess={reloadAccess} />
      <PeopleCard title="Guides" hint="Field guides and tour leaders" table="guides" people={guides} team={team.filter(m => m.active)}
        usage={guideUsage} tenantId={tenant.id} reload={reload} access={access} reloadAccess={reloadAccess} />
    </div>
  )
}
