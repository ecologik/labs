import { useState } from 'react'
import { useSession } from '../lib/session'
import { updateTrip } from '../lib/data'

const GIFT_KINDS = [['MBV', 'MBV Gift'], ['NonMBV', 'Non-MBV Gift'], ['NA', 'N/A']]
const num = v => (v === '' || v == null ? null : Number(v))

// Right-side "Edit trip details" drawer. Core columns (name, type, dates, lead) plus the
// tenant's intake fields, which live in trips.details. Module sections show only when on.
export default function TripDrawer({ tenant, trip, teamById, guides, onClose, onSaved }) {
  const { hasModule } = useSession()
  const s = tenant.settings || {}
  const d = trip.details || {}
  const flags = s.trip_flags || []
  const [f, setF] = useState({
    name: trip.name, trip_type: trip.trip_type || '', start_date: trip.start_date || '', end_date: trip.end_date || '',
    lead_id: trip.lead_id || '',
    tour_name: d.tour_name || '', pax_min: d.pax_min ?? '', pax_max: d.pax_max ?? '',
    destinations: d.destinations || [], tour_leader_id: d.tour_leader_id || '', notes: d.notes || '',
    flags: Object.fromEntries(flags.map(fl => [fl.key, Boolean(d[fl.key])])),
    heritage_folder: d.heritage_folder?.url || '',
    links: { client_file: '', nivo: '', budget: '', ...(d.links || {}) },
    gift: { kind: 'NA', location: '', rooms: '', note: '', ...(d.gift || {}) },
  })
  const [adding, setAdding] = useState(false)
  const [newDest, setNewDest] = useState('')
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)

  const set = k => e => setF(v => ({ ...v, [k]: e.target.value }))
  const setIn = (grp, k) => e => setF(v => ({ ...v, [grp]: { ...v[grp], [k]: e.target.value } }))
  const allDests = [...new Set([...(s.destinations || []), ...f.destinations])]
  const toggleDest = x => setF(v => ({ ...v, destinations: v.destinations.includes(x) ? v.destinations.filter(y => y !== x) : [...v.destinations, x] }))
  const addDest = () => {
    const x = newDest.trim()
    if (x && !f.destinations.includes(x)) setF(v => ({ ...v, destinations: [...v.destinations, x] }))
    setNewDest(''); setAdding(false)
  }
  const heritageOn = flags.some(fl => fl.key === 'heritage') && f.flags.heritage

  const save = async e => {
    e.preventDefault()
    if (f.start_date && f.end_date && f.end_date < f.start_date) { setErr('The end date is before the start date.'); return }
    const pMin = num(f.pax_min), pMax = num(f.pax_max)
    if (pMin != null && pMax != null && pMin > pMax) { setErr('Passengers (min) is more than (max).'); return }
    const links = Object.fromEntries(Object.entries(f.links).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v))
    const patch = {
      tour_name: f.tour_name.trim() || null, pax_min: pMin, pax_max: pMax, destinations: f.destinations,
      tour_leader_id: f.tour_leader_id || null, notes: f.notes.trim() || null, links, ...f.flags,
    }
    if (hasModule('heritage')) patch.heritage_folder = f.heritage_folder.trim() ? { ...(d.heritage_folder || {}), url: f.heritage_folder.trim() } : null
    if (hasModule('gifts')) patch.gift = { ...f.gift, rooms: num(f.gift.rooms), location: f.gift.location.trim(), note: f.gift.note.trim() }
    setBusy(true); setErr(null)
    try {
      await updateTrip(tenant.id, trip, {
        name: f.name.trim() || trip.name, trip_type: f.trip_type || null, start_date: f.start_date || null,
        end_date: f.end_date || null, lead_id: f.lead_id || null,
      }, patch)
      await onSaved()
      onClose()
    } catch (x) { setErr(x.message); setBusy(false) }
  }

  return (
    <>
      <div className="drawer-bg" onClick={onClose} />
      <form className="drawer" onSubmit={save} aria-label="Edit trip details">
        <div className="drawer-h">
          <div><h2>Edit trip details</h2><div className="muted small">{trip.name}</div></div>
          <button type="button" className="modal-x" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="drawer-b">
          <label>Trip name<input required value={f.name} onChange={set('name')} /></label>
          <label>Tour name · month, year of travel<input value={f.tour_name} onChange={set('tour_name')} placeholder="e.g. August, 2026" /></label>
          <div className="row2">
            <label>Start<input type="date" value={f.start_date} onChange={set('start_date')} /></label>
            <label>End<input type="date" value={f.end_date} min={f.start_date || undefined} onChange={set('end_date')} /></label>
          </div>
          <div className="row2">
            <label>Passengers (min)<input type="number" min="0" value={f.pax_min} onChange={set('pax_min')} placeholder="min" /></label>
            <label>Passengers (max)<input type="number" min="0" value={f.pax_max} onChange={set('pax_max')} placeholder="max" /></label>
          </div>
          <div className="row2">
            <label>Trip type<select value={f.trip_type} onChange={set('trip_type')}>
              {!f.trip_type && <option value="">—</option>}
              {(s.trip_types || []).map(x => <option key={x}>{x}</option>)}
              {f.trip_type && !(s.trip_types || []).includes(f.trip_type) && <option>{f.trip_type}</option>}
            </select></label>
            {flags.map(fl => (
              <div className="field" key={fl.key}><span className="lbl">{fl.label} trip?</span>
                <div className="yn">
                  <button type="button" className={f.flags[fl.key] ? 'on' : ''} onClick={() => setF(v => ({ ...v, flags: { ...v.flags, [fl.key]: true } }))}>Yes</button>
                  <button type="button" className={!f.flags[fl.key] ? 'on' : ''} onClick={() => setF(v => ({ ...v, flags: { ...v.flags, [fl.key]: false } }))}>No</button>
                </div>
              </div>
            ))}
          </div>
          {flags.some(fl => f.flags[fl.key] && !d[fl.key]) && <p className="hint">Saving adds the {flags.filter(fl => f.flags[fl.key] && !d[fl.key]).map(fl => fl.label).join(' and ')} checklist to this trip.</p>}

          <div className="field"><span className="lbl">Destinations (select one or more)</span>
            <div className="pchips">
              {allDests.map(x => <button type="button" key={x} className={'pchip' + (f.destinations.includes(x) ? ' on' : '')} onClick={() => toggleDest(x)}>{x}</button>)}
              {adding
                ? <span className="addbox"><input autoFocus value={newDest} onChange={e => setNewDest(e.target.value)} placeholder="New destination"
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addDest() } if (e.key === 'Escape') setAdding(false) }} />
                    <button type="button" className="linkbtn" onClick={addDest}>Add</button></span>
                : <button type="button" className="pchip add" onClick={() => setAdding(true)}>+ Add destination</button>}
            </div>
          </div>

          <div className="row2">
            <label>Travel specialist<select value={f.lead_id} onChange={set('lead_id')}><option value="">—</option>
              {Object.values(teamById).filter(m => m.active || m.id === f.lead_id).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
            <label>Tour leader<select value={f.tour_leader_id} onChange={set('tour_leader_id')}><option value="">— none —</option>
              {guides.filter(g => g.active || g.id === f.tour_leader_id).map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label>
          </div>

          {hasModule('heritage') && heritageOn && <>
            <div className="sect">Heritage research folder</div>
            <div className="note-box">A <b>separate</b> Drive folder for this family's ancestry: photos of relatives, gravestones and records. It's not the intake document.
              For now paste the folder's link; picking it from Drive comes with the Google Drive step.</div>
            <label>Folder link<input type="url" value={f.heritage_folder} onChange={set('heritage_folder')} placeholder="https://drive.google.com/drive/folders/…" /></label>
          </>}

          {hasModule('gifts') && <>
            <div className="sect">Gift in room</div>
            <div className="field"><span className="lbl">Gift type</span>
              <div className="yn">{GIFT_KINDS.map(([k, label]) => (
                <button type="button" key={k} className={f.gift.kind === k ? 'on' : ''} onClick={() => setF(v => ({ ...v, gift: { ...v.gift, kind: k } }))}>{label}</button>))}
              </div>
            </div>
            {f.gift.kind !== 'NA' && <>
              <div className="row2">
                <label>Where is the gift?<input value={f.gift.location} onChange={setIn('gift', 'location')} placeholder="e.g. In room / front desk" /></label>
                <label># of rooms<input type="number" min="0" step="1" value={f.gift.rooms ?? ''} onChange={setIn('gift', 'rooms')} placeholder="e.g. 3" /></label>
              </div>
              <label>Notes regarding gift<textarea rows="2" value={f.gift.note} onChange={setIn('gift', 'note')} placeholder="What is the gift, any special handling…" /></label>
            </>}
          </>}

          <div className="sect">Notes</div>
          <label>VIP? Return client? Referral? Celebrations?<textarea rows="3" value={f.notes} onChange={set('notes')} placeholder="Anything else the team needs to know…" /></label>

          <div className="sect">Links</div>
          <label>Client file (intake doc)<input type="url" value={f.links.client_file} onChange={setIn('links', 'client_file')} placeholder="https://docs.google.com/…" /></label>
          <label>Nivo trip<input type="url" value={f.links.nivo} onChange={setIn('links', 'nivo')} placeholder="https://…softripng.com/…" /></label>
          <label>Budget spreadsheet<input type="url" value={f.links.budget} onChange={setIn('links', 'budget')} placeholder="https://docs.google.com/spreadsheets/…" /></label>
        </div>
        <div className="drawer-f">
          {err && <p className="err">{err}</p>}
          <span className="push" />
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Save details'}</button>
        </div>
      </form>
    </>
  )
}
