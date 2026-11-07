import { useRef, useState } from 'react'
import { createTrip } from '../lib/data'
import { useSession } from '../lib/session'
import { readClientFile } from '../lib/clientFile'

export default function NewTripModal({ tenant, teamById, guides = [], onClose, onCreated }) {
  const { hasModule } = useSession()
  const s = tenant.settings || {}
  const [f, setF] = useState({ name: '', tripType: s.trip_types?.[0] || '', salesStage: s.sales_stages?.[0] || '', startDate: '', endDate: '', leadId: '', details: {} })
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const [imp, setImp] = useState(null)        // { file, report } after reading a client file
  const [over, setOver] = useState(false)
  const fileRef = useRef(null)
  const set = k => e => setF(v => ({ ...v, [k]: e.target.value }))

  const load = async file => {
    if (!file) return
    setErr(null)
    try {
      const r = await readClientFile(file, {
        tripTypes: s.trip_types || [], destinations: s.destinations || [], flags: s.trip_flags || [],
        team: Object.values(teamById).filter(m => m.active), guides: guides.filter(g => g.active), gifts: hasModule('gifts'),
      })
      setF(v => ({ ...v, ...r.fields, details: { ...v.details, ...r.details } }))
      setImp({ file: file.name, report: r.report })
    } catch (x) { setErr(x.message) }
  }

  const submit = async e => {
    e.preventDefault()
    if (f.startDate && f.endDate && f.endDate < f.startDate) { setErr('The end date is before the start date.'); return }
    setBusy(true); setErr(null)
    try { onCreated(await createTrip(tenant.id, f)) } catch (x) { setErr(x.message); setBusy(false) }
  }
  const filled = imp?.report.filter(r => r.status !== 'empty') || []
  const blanks = imp?.report.filter(r => r.status === 'empty').map(r => r.label) || []

  return (
    <div className="modal-bg" onClick={onClose}>
      <form className={'modal newtrip' + (imp ? ' wide' : '')} onClick={e => e.stopPropagation()} onSubmit={submit}>
        <h2>New trip</h2>

        <div className={'cf-drop' + (over ? ' over' : '')}
          onDragOver={e => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)}
          onDrop={e => { e.preventDefault(); setOver(false); load(e.dataTransfer.files?.[0]) }}>
          <button type="button" className="btn ghost" onClick={() => fileRef.current?.click()}>{imp ? 'Use a different file' : 'Fill from client file'}</button>
          <span className="muted small">{imp ? <>Filled from <b>{imp.file}</b>. Check below, then create.</> : 'Upload the Word client file (.docx) from the Drive folder, or drop it here.'}</span>
          <input ref={fileRef} type="file" hidden accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={e => { const x = e.target.files?.[0]; e.target.value = ''; load(x) }} />
        </div>

        {imp && (
          <div className="cf-report">
            {filled.map(r => (
              <div key={r.label} className={'cf-row ' + r.status}>
                <span className="cf-ic">{r.status === 'ok' ? '✓' : '!'}</span>
                <span className="cf-l">{r.label}</span>
                <span className="cf-v">{r.value}{r.note && <span className="cf-n"> · {r.note}</span>}</span>
              </div>
            ))}
            {blanks.length > 0 && <div className="muted small">Not filled in the file: {blanks.join(', ')}</div>}
            <div className="muted small">Passengers, destinations, tour leader, gift and notes are saved with the trip; change them later in <b>Edit trip details</b>.</div>
          </div>
        )}

        <label>Trip name<input required autoFocus value={f.name} onChange={set('name')} /></label>
        <div className="row2">
          <label>Trip type<select value={f.tripType} onChange={set('tripType')}>{(s.trip_types || []).map(x => <option key={x}>{x}</option>)}</select></label>
          <label>Sales stage<select value={f.salesStage} onChange={set('salesStage')}>{(s.sales_stages || []).map(x => <option key={x}>{x}</option>)}</select></label>
        </div>
        <div className="row2">
          <label>Start<input type="date" value={f.startDate} onChange={set('startDate')} /></label>
          <label>End<input type="date" value={f.endDate} min={f.startDate} onChange={set('endDate')} /></label>
        </div>
        <label>Travel specialist<select value={f.leadId} onChange={set('leadId')}><option value="">—</option>
          {Object.values(teamById).filter(m => m.active).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
        {(s.trip_flags || []).length > 0 && (
          <div className="checks">
            {s.trip_flags.map(fl => (
              <label key={fl.key} className="check">
                <input type="checkbox" checked={Boolean(f.details[fl.key])}
                  onChange={e => setF(v => ({ ...v, details: { ...v.details, [fl.key]: e.target.checked } }))} />✦ {fl.label} trip
              </label>
            ))}
          </div>
        )}
        {err && <p className="err">{err}</p>}
        <div className="modal-f"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn" disabled={busy}>Create trip</button></div>
      </form>
    </div>
  )
}
