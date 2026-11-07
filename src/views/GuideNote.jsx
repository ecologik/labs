import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { fetchSegments, updateTrip } from '../lib/data'
import { fmtRange, parseDate } from '../lib/format'
import { useSession } from '../lib/session'

// Guide Note (module: guide_note). What the guides need on the ground: guests, contacts,
// allergies, arrival info, hotels and the itinerary. Staff fill it in as details arrive;
// it prints as one clean sheet. Stored in trips.details.guide_note.

const EMPTY_HOTEL = { name: '', check_in: '', check_out: '', address: '', phone: '', room_type: '', confirmation: '' }
const DAY = 86400000
const nights = (a, b) => (a && b ? Math.round((parseDate(b) - parseDate(a)) / DAY) : null)
const longDate = s => s ? parseDate(s).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : ''
const shortDate = s => s ? parseDate(s).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : ''
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`

function blank(gn = {}) {
  return {
    guests: gn.guests?.length ? gn.guests : [{ name: '', age: '' }],
    nationality: gn.nationality || '', client_phone: gn.client_phone || '', important: gn.important || '',
    allergies: gn.allergies || '', transport: gn.transport || '',
    client_expenses: gn.client_expenses || '', per_diem: gn.per_diem || '',
    hotels: gn.hotels?.length ? gn.hotels.map(h => ({ ...EMPTY_HOTEL, ...h })) : [],
    itinerary: gn.itinerary || '', booking_agent: gn.booking_agent || '',
    trip_manager_id: gn.trip_manager_id || '', confirmations_id: gn.confirmations_id || '',
    hype: { amount: '', to: '', on: '', ...(gn.hype || {}) },
    brief_sent_by: gn.brief_sent_by || '', brief_sent_on: gn.brief_sent_on || '',
  }
}
// Drop empty rows/strings before saving.
function clean(f) {
  const t = v => (v ?? '').toString().trim()
  const hotels = f.hotels.map(h => Object.fromEntries(Object.entries(h).map(([k, v]) => [k, t(v)])))
    .filter(h => Object.values(h).some(Boolean))
    .sort((a, b) => (a.check_in || '9999').localeCompare(b.check_in || '9999'))
  return {
    guests: f.guests.map(g => ({ name: t(g.name), age: t(g.age) })).filter(g => g.name || g.age),
    nationality: t(f.nationality), client_phone: t(f.client_phone), important: t(f.important),
    allergies: t(f.allergies), transport: t(f.transport), client_expenses: t(f.client_expenses), per_diem: t(f.per_diem),
    hotels, itinerary: t(f.itinerary), booking_agent: t(f.booking_agent),
    trip_manager_id: f.trip_manager_id || null, confirmations_id: f.confirmations_id || null,
    hype: { amount: t(f.hype.amount), to: f.hype.to || null, on: f.hype.on || null },
    brief_sent_by: f.brief_sent_by || null, brief_sent_on: f.brief_sent_on || null,
    updated_at: new Date().toISOString(),
  }
}

// ---------- editor ----------
function GuideNoteDrawer({ tenant, trip, teamById, guides, onClose, onSaved }) {
  const [f, setF] = useState(() => blank(trip.details?.guide_note))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const set = k => e => setF(v => ({ ...v, [k]: e.target.value }))
  const setHype = k => e => setF(v => ({ ...v, hype: { ...v.hype, [k]: e.target.value } }))
  const team = Object.values(teamById).filter(m => m.active || [f.trip_manager_id, f.confirmations_id, f.brief_sent_by].includes(m.id))
  const teamOpts = <>{team.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</>
  // Trip manager / confirmations can be office staff or a guide (e.g. a guide who runs the trip).
  const anyOpts = <><optgroup label="Office team">{teamOpts}</optgroup>
    <optgroup label="Guides">{guides.filter(g => g.active || [f.trip_manager_id, f.confirmations_id].includes(g.id)).map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</optgroup></>
  const setRow = (list, i, k) => e => setF(v => ({ ...v, [list]: v[list].map((r, j) => j === i ? { ...r, [k]: e.target.value } : r) }))
  const addRow = (list, row) => setF(v => ({ ...v, [list]: [...v[list], row] }))
  const delRow = (list, i) => setF(v => ({ ...v, [list]: v[list].filter((_, j) => j !== i) }))

  const save = async e => {
    e.preventDefault()
    const bad = f.hotels.find(h => h.check_in && h.check_out && h.check_out < h.check_in)
    if (bad) { setErr(`${bad.name || 'A hotel'}: check-out is before check-in.`); return }
    setBusy(true); setErr(null)
    try { await updateTrip(tenant.id, trip, {}, { guide_note: clean(f) }); await onSaved(); onClose() }
    catch (x) { setErr(x.message); setBusy(false) }
  }

  return (
    <>
      <div className="drawer-bg" onClick={onClose} />
      <form className="drawer gn-drawer" onSubmit={save} aria-label="Edit guide note">
        <div className="drawer-h">
          <div><h2>Guide note</h2><div className="muted small">{trip.name} · {fmtRange(trip.start_date, trip.end_date)}</div></div>
          <button type="button" className="modal-x" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="drawer-b">
          <div className="sect">Brief</div>
          <div className="row2">
            <label>Trip manager<select value={f.trip_manager_id} onChange={set('trip_manager_id')}><option value="">—</option>{anyOpts}</select></label>
            <label>Confirmations<select value={f.confirmations_id} onChange={set('confirmations_id')}><option value="">—</option>{anyOpts}</select></label>
          </div>
          <div className="row3">
            <label>Hype money (amount)<input value={f.hype.amount} onChange={setHype('amount')} placeholder="e.g. €200" /></label>
            <label>Sent to<select value={f.hype.to} onChange={setHype('to')}><option value="">—</option>
              {guides.filter(g => g.active || g.id === f.hype.to).map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label>
            <label>On<input type="date" value={f.hype.on} onChange={setHype('on')} /></label>
          </div>
          <div className="row2">
            <label>Brief sent by<select value={f.brief_sent_by} onChange={set('brief_sent_by')}><option value="">—</option>{teamOpts}</select></label>
            <label>On<input type="date" value={f.brief_sent_on} onChange={set('brief_sent_on')} /></label>
          </div>

          <div className="sect">Client details</div>
          <div className="field"><span className="lbl">Guests (name and age)</span>
            {f.guests.map((g, i) => (
              <div className="gn-guest" key={i}>
                <input value={g.name} onChange={setRow('guests', i, 'name')} placeholder="Full name" aria-label={`Guest ${i + 1} name`} />
                <input value={g.age} onChange={setRow('guests', i, 'age')} placeholder="Age" aria-label={`Guest ${i + 1} age`} className="gn-age" />
                <button type="button" className="gn-x" onClick={() => delRow('guests', i)} aria-label="Remove guest">×</button>
              </div>
            ))}
            <button type="button" className="linkbtn" onClick={() => addRow('guests', { name: '', age: '' })}>+ Add guest</button>
          </div>
          <div className="row2">
            <label>Guest nationality<input value={f.nationality} onChange={set('nationality')} placeholder="e.g. American" /></label>
            <label>Client phone number(s)<input value={f.client_phone} onChange={set('client_phone')} placeholder="+1 …" /></label>
          </div>
          <label>Booking agent / referral<input value={f.booking_agent} onChange={set('booking_agent')} placeholder="Name, agency, phone, email" /></label>
          <label>Important information<textarea rows="3" value={f.important} onChange={set('important')} placeholder="Mobility, celebrations, booking agent contact, anything the guide must know…" /></label>
          <label>Allergies<textarea rows="2" value={f.allergies} onChange={set('allergies')} placeholder="Food allergies, dietary needs…" /></label>
          <label>Train / flight info<textarea rows="2" value={f.transport} onChange={set('transport')} placeholder="Arrival and departure: flights, trains, cruise ship and port…" /></label>

          <div className="sect">Payment notes</div>
          <div className="row2">
            <label>Client expenses<textarea rows="2" value={f.client_expenses} onChange={set('client_expenses')} placeholder="What the client pays on the ground" /></label>
            <label>Per diem<textarea rows="2" value={f.per_diem} onChange={set('per_diem')} placeholder="Guide per diem" /></label>
          </div>

          <div className="sect">Hotels</div>
          {f.hotels.map((h, i) => {
            const n = nights(h.check_in, h.check_out)
            return (
              <div className="gn-hotel" key={i}>
                <div className="gn-hotel-h"><b>Hotel #{i + 1}</b>{n > 0 && <span className="muted small">{plural(n, 'night')}</span>}
                  <button type="button" className="linkbtn subtle danger-txt" onClick={() => delRow('hotels', i)}>Remove</button></div>
                <label>Hotel name<input value={h.name} onChange={setRow('hotels', i, 'name')} /></label>
                <div className="row2">
                  <label>Check in<input type="date" value={h.check_in} onChange={setRow('hotels', i, 'check_in')} min={trip.start_date || undefined} /></label>
                  <label>Check out<input type="date" value={h.check_out} onChange={setRow('hotels', i, 'check_out')} min={h.check_in || undefined} /></label>
                </div>
                <label>Address<input value={h.address} onChange={setRow('hotels', i, 'address')} /></label>
                <div className="row2">
                  <label>Phone<input value={h.phone} onChange={setRow('hotels', i, 'phone')} /></label>
                  <label>Room type<input value={h.room_type} onChange={setRow('hotels', i, 'room_type')} /></label>
                </div>
                <label>Confirmation #<input value={h.confirmation} onChange={setRow('hotels', i, 'confirmation')} /></label>
              </div>
            )
          })}
          <button type="button" className="linkbtn" onClick={() => {
            const last = f.hotels[f.hotels.length - 1]
            addRow('hotels', { ...EMPTY_HOTEL, check_in: last?.check_out || (f.hotels.length ? '' : trip.start_date || '') })
          }}>+ Add hotel</button>

          <div className="sect">Itinerary details</div>
          <label>Day by day<textarea rows="8" value={f.itinerary} onChange={set('itinerary')}
            placeholder={'Day 1 · May 6: Arrive Civitavecchia, transfer to Rome…\nDay 2 · …'} /></label>
          <p className="hint">The guide schedule (who guides which days) prints with the note automatically.</p>
        </div>
        <div className="drawer-f">
          {err && <p className="err">{err}</p>}
          <span className="push" />
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Save guide note'}</button>
        </div>
      </form>
    </>
  )
}

// ---------- printable sheet ----------
const Row = ({ label, children }) => children ? <div className="gp-row"><div className="gp-l">{label}</div><div className="gp-v">{children}</div></div> : null

function GuideNotePrint({ tenant, trip, teamById, guides, onClose }) {
  const { hasModule } = useSession()
  const gn = trip.details?.guide_note || {}
  const d = trip.details || {}
  const [segs, setSegs] = useState([])
  const schedOn = hasModule('guide_schedule')
  useEffect(() => {
    if (!schedOn) return
    fetchSegments(tenant.id, trip.id).then(setSegs).catch(() => {})
  }, [tenant.id, trip.id, schedOn])
  useEffect(() => {
    const k = e => { if (e.key === 'Escape') onClose() }
    document.body.classList.add('gn-printing'); window.addEventListener('keydown', k)
    return () => { document.body.classList.remove('gn-printing'); window.removeEventListener('keydown', k) }
  }, [onClose])
  const guideById = Object.fromEntries(guides.map(g => [g.id, g]))
  const leader = guideById[d.tour_leader_id]
  const person = id => teamById[id] || guideById[id]
  // Guides on the schedule (besides the tour leader), with their phones.
  const onTrip = [...new Set(segs.map(x => x.guide_id).filter(Boolean))].filter(id => id !== d.tour_leader_id).map(id => guideById[id]).filter(Boolean)
  const lead = teamById[trip.lead_id]
  const days = nights(trip.start_date, trip.end_date)
  const pax = d.pax_min && d.pax_max && d.pax_min !== d.pax_max ? `${d.pax_min}–${d.pax_max}` : d.pax_max || d.pax_min
  const logo = tenant.settings?.branding?.logo
  const guests = gn.guests || [], hotels = gn.hotels || []

  return createPortal(
    <div className="gn-print">
      <div className="gn-toolbar">
        <b>Guide note</b><span className="muted small">Check it, then print or save as PDF.</span>
        <span className="push" />
        <button className="btn" onClick={() => window.print()}>Print / Save PDF</button>
        <button className="btn ghost" onClick={onClose}>Close</button>
      </div>
      <article className="gn-sheet">
        <header className="gp-head">
          {logo ? <img src={logo} alt={tenant.name} className="gp-logo" /> : <div className="gp-org">{tenant.name}</div>}
          <div className="gp-title">
            <div className="gp-kicker">Guide note</div>
            <h1>{trip.name}</h1>
            <div className="gp-sub">
              {fmtRange(trip.start_date, trip.end_date)}{days != null && days >= 0 ? ` · ${plural(days + 1, 'day')}` : ''}
              {pax ? ` · ${pax} guests` : ''}{(d.destinations || []).length ? ` · ${d.destinations.join(', ')}` : ''}
            </div>
          </div>
        </header>
        <div className="gp-contacts">
          {[['Travel specialist', lead], ['Trip manager', person(gn.trip_manager_id)], ['Confirmations', person(gn.confirmations_id)], ['Tour leader', leader]]
            .filter(([, p]) => p).map(([role, p]) => <div key={role}><span>{role}</span><b>{p.name}</b>{p.phone && <em>{p.phone}</em>}</div>)}
          {onTrip.map(g => <div key={g.id}><span>Guide</span><b>{g.name}</b>{g.phone && <em>{g.phone}</em>}</div>)}
          {gn.client_phone && <div><span>Client phone</span><b>{gn.client_phone}</b></div>}
        </div>
        {(d.links?.nivo || gn.hype?.amount) && (
          <div className="gp-line">
            {d.links?.nivo && <span>Itinerary in Nivo: <a href={d.links.nivo}>{d.links.nivo}</a></span>}
            {gn.hype?.amount && <span>Hype money: <b>{gn.hype.amount}</b>{guideById[gn.hype.to] ? ` sent to ${guideById[gn.hype.to].name}` : ''}{gn.hype.on ? ` on ${shortDate(gn.hype.on)}` : ''}</span>}
          </div>
        )}

        <section>
          <h2>Client details</h2>
          <Row label="Dates">{trip.start_date ? (trip.end_date && trip.end_date !== trip.start_date ? `${longDate(trip.start_date)} – ${longDate(trip.end_date)}` : `${longDate(trip.start_date)} (one day)`) : 'TBD'}</Row>
          <Row label="Guests">{guests.length > 0 && <ul className="gp-guests">{guests.map((g, i) => <li key={i}>{g.name || '—'}{g.age && <span> · {g.age}</span>}</li>)}</ul>}</Row>
          <Row label="Nationality">{gn.nationality}</Row>
          <Row label="Booking agent">{gn.booking_agent}</Row>
          <Row label="Important">{gn.important}</Row>
          <Row label="Allergies">{gn.allergies && <span className="gp-alert">{gn.allergies}</span>}</Row>
          <Row label="Train / flight">{gn.transport}</Row>
        </section>

        {(gn.client_expenses || gn.per_diem) && (
          <section>
            <h2>Payment notes</h2>
            <Row label="Client expenses">{gn.client_expenses}</Row>
            <Row label="Per diem">{gn.per_diem}</Row>
          </section>
        )}

        {hotels.length > 0 && (
          <section>
            <h2>Hotels</h2>
            <div className="gp-hotels">
              {hotels.map((h, i) => {
                const n = nights(h.check_in, h.check_out)
                return (
                  <div className="gp-hotel" key={i}>
                    <div className="gp-hotel-h"><b>{h.name || `Hotel #${i + 1}`}</b>
                      {h.check_in && <span>{shortDate(h.check_in)} → {shortDate(h.check_out) || '?'}{n > 0 ? ` · ${plural(n, 'night')}` : ''}</span>}</div>
                    {h.address && <div>{h.address}</div>}
                    {h.phone && <div>☎ {h.phone}</div>}
                    {(h.room_type || h.confirmation) && <div className="gp-muted">{[h.room_type, h.confirmation && `Conf. # ${h.confirmation}`].filter(Boolean).join(' · ')}</div>}
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {(segs.length > 0 || gn.itinerary) && (
          <section>
            <h2>Itinerary details</h2>
            {segs.length > 0 && (
              <table className="gp-segs"><tbody>
                {segs.map(sg => (
                  <tr key={sg.id}>
                    <td className="gp-when">{sg.start_date === sg.end_date ? shortDate(sg.start_date) : `${shortDate(sg.start_date)} – ${shortDate(sg.end_date)}`}</td>
                    <td><b>{sg.label}</b>{sg.note && <div className="gp-muted">{sg.note}</div>}</td>
                    <td className="gp-who">{guideById[sg.guide_id]?.name || 'On their own'}</td>
                  </tr>
                ))}
              </tbody></table>
            )}
            {gn.itinerary && <div className="gp-text">{gn.itinerary}</div>}
          </section>
        )}
        <footer className="gp-foot">{tenant.name}{teamById[gn.brief_sent_by] ? ` · brief sent by ${teamById[gn.brief_sent_by].name}${gn.brief_sent_on ? ` on ${shortDate(gn.brief_sent_on)}` : ''}` : ''}{gn.updated_at ? ` · updated ${new Date(gn.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}</footer>
      </article>
    </div>,
    document.body,
  )
}

// ---------- card on the trip page ----------
export default function GuideNoteCard({ tenant, trip, teamById, guides, reload }) {
  const [editing, setEditing] = useState(false)
  const [printing, setPrinting] = useState(false)
  const gn = trip.details?.guide_note
  const guests = gn?.guests?.length || 0, hotels = gn?.hotels || []
  const missing = !gn ? [] : [
    !guests && 'guests', !gn.client_phone && 'client phone', !hotels.length && 'hotels', !gn.transport && 'train / flight',
  ].filter(Boolean)
  return (
    <div className="card gn-card">
      <div className="card-h">
        <h2>Guide note</h2>
        <span className="muted small">{gn ? `${plural(guests, 'guest')} · ${plural(hotels.length, 'hotel')}${gn.allergies ? ' · allergies noted' : ''}` : 'Not started'}</span>
        <span className="push" />
        <button className="btn ghost sm" onClick={() => setEditing(true)}>✎ {gn ? 'Edit' : 'Start guide note'}</button>
        {gn && <button className="btn sm" onClick={() => setPrinting(true)}>Print</button>}
      </div>
      {gn && hotels.length > 0 && (
        <div className="gn-hotel-strip">
          {hotels.map((h, i) => <span key={i} className="gn-pill"><b>{h.name || `Hotel #${i + 1}`}</b> {h.check_in ? `${shortDate(h.check_in)} → ${shortDate(h.check_out) || '?'}` : ''}</span>)}
        </div>
      )}
      {gn && missing.length > 0 && <p className="muted small gn-missing">Still missing: {missing.join(', ')}</p>}
      {!gn && <p className="muted small" style={{ margin: 0 }}>Guests, contacts, allergies, arrival info, hotels and itinerary for the guides, as one printable sheet.</p>}
      {editing && <GuideNoteDrawer tenant={tenant} trip={trip} teamById={teamById} guides={guides} onClose={() => setEditing(false)} onSaved={reload} />}
      {printing && <GuideNotePrint tenant={tenant} trip={trip} teamById={teamById} guides={guides} onClose={() => setPrinting(false)} />}
    </div>
  )
}
