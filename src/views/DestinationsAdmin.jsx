import { useState } from 'react'
import { useSession } from '../lib/session'
import { addListItem, deleteDestination, mergeDestination, renameListItem } from '../lib/admin'

const fold = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return d[a.length][b.length]
}
// A likely twin for a name: same letters ignoring case/accents, or 1–2 typos apart.
function lookalike(name, others) {
  const n = fold(name)
  let best = null
  for (const o of others) {
    if (o === name) continue
    const m = fold(o)
    const dd = n === m ? 0 : Math.min(n.length, m.length) >= 4 ? distance(n, m) : 99
    if (dd <= (Math.min(n.length, m.length) >= 8 ? 2 : 1) && (!best || dd < best.d)) best = { name: o, d: dd }
  }
  return best?.name || null
}

// Admin list of destinations: the official list plus any typed only on a trip.
// Rename, merge one into another (trips follow), delete (comes off trips too).
export default function DestinationsAdmin({ trips, reload }) {
  const { tenant, refreshTenant } = useSession()
  const list = tenant.settings?.destinations || []
  const counts = {}
  for (const t of trips) for (const x of t.details?.destinations || []) counts[x] = (counts[x] || 0) + 1
  const extra = Object.keys(counts).filter(x => !list.includes(x)).sort((a, b) => a.localeCompare(b))
  const all = [...list, ...extra]

  const [edit, setEdit] = useState(null)       // { name, mode: 'rename'|'merge', value }
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [msg, setMsg] = useState(null)

  const run = async (fn, done) => {
    setBusy(true); setErr(null); setMsg(null)
    try { const r = await fn(); refreshTenant(); await reload(); setEdit(null); setMsg(done(r)) }
    catch (x) { setErr(x.message) }
    finally { setBusy(false) }
  }
  // Of two look-alikes, suggest merging the one typed only on trips, else the one on fewer trips.
  const mergeAway = (a, b) => list.includes(a) !== list.includes(b) ? !list.includes(a)
    : (counts[a] || 0) !== (counts[b] || 0) ? (counts[a] || 0) < (counts[b] || 0) : a > b
  const trips_ = n => `${n} trip${n === 1 ? '' : 's'}`
  const merge = (from, into) => run(() => mergeDestination(tenant.id, from, into), r => `Merged “${from}” into “${into}” (${trips_(r?.trips ?? 0)} updated).`)
  const del = name => {
    const n = counts[name] || 0
    if (!window.confirm(`Delete “${name}”?${n ? ` It will be removed from ${trips_(n)}.` : ''}`)) return
    run(() => deleteDestination(tenant.id, name), r => `Deleted “${name}”${r?.trips ? ` and removed it from ${trips_(r.trips)}` : ''}.`)
  }
  const add = e => {
    e.preventDefault()
    const x = newName.trim()
    if (!x) return
    run(() => addListItem(tenant.id, 'destinations', x), () => { setNewName(''); return `Added “${x}”.` })
  }

  return (
    <div className="view dest-admin">
      <div className="card intro">
        <b>Destinations</b> are offered on every trip's details. Fix a misspelling by <b>merging</b> it into the right one: every trip that has it gets
        the right one instead. <b>Delete</b> removes a destination from the list and from every trip.
      </div>
      <div className="card">
        <div className="card-h"><h2>All destinations</h2><span className="muted small">{list.length} on the list{extra.length ? ` · ${extra.length} typed only on trips` : ''}</span></div>
        {err && <p className="err">{err}</p>}
        {msg && <p className="ok-msg">{msg}</p>}
        <div className="dest-list">
          {all.map(name => {
            const onList = list.includes(name)
            const twin = lookalike(name, all)
            const ed = edit?.name === name ? edit : null
            return (
              <div key={name} className={'dest-row' + (onList ? '' : ' extra')}>
                <div className="dest-main">
                  <span className="dest-name">{name}</span>
                  {!onList && <span className="chip warn-chip">only on trips</span>}
                  <span className="muted small">{trips_(counts[name] || 0)}</span>
                  {twin && !ed && mergeAway(name, twin) &&
                    <button className="linkbtn small dest-hint" disabled={busy} onClick={() => merge(name, twin)}>Looks like “{twin}”: merge into it</button>}
                </div>
                {ed ? (
                  <form className="dest-edit" onSubmit={e => {
                    e.preventDefault()
                    const v = ed.value.trim()
                    if (!v || v === name) return
                    if (ed.mode === 'rename') run(() => renameListItem(tenant.id, 'destinations', name, v), () => `Renamed “${name}” to “${v}” everywhere.`)
                    else merge(name, v)
                  }}>
                    {ed.mode === 'rename'
                      ? <input autoFocus value={ed.value} onChange={e => setEdit({ ...ed, value: e.target.value })} aria-label="New name" />
                      : <select autoFocus value={ed.value} onChange={e => setEdit({ ...ed, value: e.target.value })} aria-label="Merge into">
                          <option value="">Merge into…</option>
                          {all.filter(x => x !== name).map(x => <option key={x}>{x}</option>)}
                        </select>}
                    <button className="btn sm" disabled={busy || !ed.value.trim() || ed.value.trim() === name}>{ed.mode === 'rename' ? 'Rename' : 'Merge'}</button>
                    <button type="button" className="btn ghost sm" onClick={() => setEdit(null)}>Cancel</button>
                  </form>
                ) : (
                  <div className="dest-acts">
                    {onList
                      ? <button className="linkbtn subtle" disabled={busy} onClick={() => setEdit({ name, mode: 'rename', value: name })}>Rename</button>
                      : <button className="linkbtn subtle" disabled={busy} onClick={() => run(() => addListItem(tenant.id, 'destinations', name), () => `Added “${name}” to the list.`)}>Add to list</button>}
                    <button className="linkbtn subtle" disabled={busy || all.length < 2} onClick={() => setEdit({ name, mode: 'merge', value: '' })}>Merge into…</button>
                    <button className="linkbtn subtle danger-txt" disabled={busy} onClick={() => del(name)}>Delete</button>
                  </div>
                )}
              </div>
            )
          })}
          {!all.length && <p className="muted small">No destinations yet.</p>}
        </div>
        <form className="dest-add" onSubmit={add}>
          <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="New destination, e.g. Capri" maxLength={80} />
          <button className="btn" disabled={busy || !newName.trim()}>Add</button>
        </form>
      </div>
    </div>
  )
}
