import { useCallback, useEffect, useRef, useState } from 'react'
import { deleteSegment, fetchSegments, saveSegment } from '../lib/data'
import { parseDate } from '../lib/format'

const DAY = 86400000
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
const diff = (a, b) => Math.round((a - b) / DAY)
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const initials = n => n.split(/\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase()
const dayLabel = d => d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

const CalIcon = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" /></svg>

// Create / edit one segment: label, days, guide, note.
function SegmentModal({ seg, days, guides, onSave, onDelete, onClose }) {
  const start = days[0], n = days.length
  const toIdx = v => clamp(diff(parseDate(v), start), 0, n - 1)
  const create = !seg.id
  const [label, setLabel] = useState(seg.label || '')
  const [si, setSi] = useState(seg.start_date ? toIdx(seg.start_date) : 0)
  const [ei, setEi] = useState(seg.end_date ? toIdx(seg.end_date) : 0)
  const [guide, setGuide] = useState(seg.guide_id || '')
  const [note, setNote] = useState(seg.note || '')
  const [busy, setBusy] = useState(false)
  const save = async e => {
    e.preventDefault()
    if (!label.trim()) return
    const a = Math.min(si, ei), b = Math.max(si, ei)
    setBusy(true)
    try { await onSave({ id: seg.id, label: label.trim(), start_date: iso(days[a]), end_date: iso(days[b]), guide_id: guide || null, note: note.trim() }) }
    finally { setBusy(false) }
  }
  return (
    <div className="modal-bg" onClick={onClose}>
      <form className="modal seg-modal" onClick={e => e.stopPropagation()} onSubmit={save}>
        <div className="modal-top"><h2>{create ? 'Add segment' : 'Edit segment'}</h2><button type="button" className="modal-x" onClick={onClose} aria-label="Close">×</button></div>
        <label>Label<input autoFocus required value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. Guided Palermo & Monreale" /></label>
        <div className="row2">
          <label>From<select value={si} onChange={e => setSi(+e.target.value)}>{days.map((d, i) => <option key={i} value={i}>{dayLabel(d)}</option>)}</select></label>
          <label>To<select value={ei} onChange={e => setEi(+e.target.value)}>{days.map((d, i) => <option key={i} value={i}>{dayLabel(d)}</option>)}</select></label>
        </div>
        <label>Guide with the group<select value={guide} onChange={e => setGuide(e.target.value)}>
          <option value="">No guide (on their own)</option>
          {guides.filter(g => g.active || g.id === guide).map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select></label>
        <label>Note<textarea rows="3" value={note} onChange={e => setNote(e.target.value)}
          placeholder="Meeting point, timing, references, what's included… Guides will see this on their Calendar." /></label>
        <div className="modal-f">
          {!create && <button type="button" className="btn ghost danger-txt" onClick={onDelete}>Delete</button>}
          <span className="push" />
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn" disabled={busy}>{create ? 'Add segment' : 'Save'}</button>
        </div>
      </form>
    </div>
  )
}

// Guide schedule for one trip: a day grid with draggable / resizable segments.
export default function GuideSchedule({ tenant, trip, guides, onEditTrip }) {
  const [segments, setSegments] = useState([])
  const [err, setErr] = useState(null)
  const [editing, setEditing] = useState(null)   // segment (existing or new draft) | null
  const gridRef = useRef(null), dragRef = useRef(null)
  const [drag, setDrag] = useState(null)       // copy of dragRef for rendering the preview

  const load = useCallback(async () => {
    try { setSegments(await fetchSegments(tenant.id, trip.id)); setErr(null) } catch (e) { setErr(e.message) }
  }, [tenant.id, trip.id])
  useEffect(() => { load() }, [load])

  const run = async fn => { setErr(null); try { await fn(); await load() } catch (e) { setErr(e.message); throw e } }
  const guideById = Object.fromEntries(guides.map(g => [g.id, g]))

  if (!trip.start_date) {
    return (
      <div className="card segwrap">
        <div className="seghead"><div className="ttl">Guide schedule</div></div>
        <p className="muted small" style={{ margin: 0 }}>Add the trip's dates in <button className="linkbtn inline" onClick={onEditTrip}>Edit trip details</button> to plan guided and independent days.</p>
      </div>
    )
  }

  const start = parseDate(trip.start_date), end = parseDate(trip.end_date || trip.start_date)
  const n = diff(end, start) + 1
  const days = Array.from({ length: n }, (_, i) => addDays(start, i))
  const idx = s => ({ a: clamp(diff(parseDate(s.start_date), start), 0, n - 1), b: clamp(diff(parseDate(s.end_date), start), 0, n - 1) })
  const outside = segments.filter(s => s.end_date < trip.start_date || s.start_date > (trip.end_date || trip.start_date))
  const placedIn = segments.filter(s => !outside.includes(s)).map(s => ({ s, ...idx(s) })).sort((x, y) => x.a - y.a || x.b - y.b)
  const laneEnd = []
  const placed = placedIn.map(o => { let L = 0; while (laneEnd[L] != null && o.a <= laneEnd[L]) L++; laneEnd[L] = o.b; return { ...o, L } })
  const guideDays = {}
  placedIn.forEach(o => { const k = o.s.guide_id || ''; guideDays[k] = (guideDays[k] || 0) + (o.b - o.a + 1) })

  const cellW = () => gridRef.current ? Math.max(24, gridRef.current.clientWidth / n) : 40
  const onDown = (e, o, mode) => {
    if (e.button !== 0) return
    e.preventDefault(); e.stopPropagation()
    dragRef.current = { id: o.s.id, mode, startX: e.clientX, a: o.a, b: o.b, curA: o.a, curB: o.b, moved: false }; setDrag({ ...dragRef.current })
    const move = ev => {
      const d = dragRef.current; if (!d) return
      const dd = Math.round((ev.clientX - d.startX) / cellW())
      let curA = d.a, curB = d.b
      if (d.mode === 'move') { const span = d.b - d.a; curA = clamp(d.a + dd, 0, n - 1 - span); curB = curA + span }
      else if (d.mode === 'l') curA = clamp(d.a + dd, 0, d.b)
      else curB = clamp(d.b + dd, d.a, n - 1)
      if (curA !== d.curA || curB !== d.curB) { d.curA = curA; d.curB = curB; d.moved = true; setDrag({ ...d }) }
      else if (Math.abs(ev.clientX - d.startX) > 4) d.moved = true
    }
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up)
      const d = dragRef.current; dragRef.current = null
      if (d) {
        const seg = segments.find(s => s.id === d.id)
        if (d.moved && (d.curA !== d.a || d.curB !== d.b)) {
          const patch = { ...seg, start_date: iso(days[d.curA]), end_date: iso(days[d.curB]) }
          setSegments(list => list.map(s => s.id === d.id ? patch : s))      // show it right away
          run(() => saveSegment(tenant.id, trip.id, patch)).catch(() => {})
        } else if (!d.moved && seg) setEditing(seg)
      }
      setDrag(null)
    }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
  }

  return (
    <div className="card segwrap">
      <div className="seghead">
        <div className="ttl">Guide schedule <span className="muted small">— drag to move or resize · click a block to edit</span></div>
        <button className="linkbtn seg-add" onClick={() => setEditing({ start_date: trip.start_date, end_date: trip.start_date })}><CalIcon /> Add segment</button>
      </div>
      {err && <p className="err">{err}</p>}
      {outside.length > 0 && (
        <div className="seg-alert"><span className="seg-alert-i">⚠</span>
          <span>{outside.length} segment{outside.length === 1 ? ' is' : 's are'} outside the trip's dates ({outside.map(s => s.label).join(', ')}). Edit {outside.length === 1 ? 'it' : 'them'} to bring back onto the timeline.</span>
          <button className="seg-alert-x" onClick={() => setEditing(outside[0])}>Edit</button>
        </div>
      )}
      <div className="segdates"><span>{dayLabel(start)}</span><span>{dayLabel(end)}</span></div>
      <div className="segscroll">
        <div className="seggrid" ref={gridRef} style={{ gridTemplateColumns: `repeat(${n}, minmax(38px,1fr))` }}>
          {days.map((d, i) => (
            <div className="segday" key={i} style={{ gridColumn: `${i + 1}/${i + 2}`, gridRow: 1 }}>
              <div className="dn">{d.getDate()}</div>{d.toLocaleDateString('en-US', { weekday: 'short' })}
            </div>
          ))}
          {placed.map(o => {
            const g = guideById[o.s.guide_id]
            const dr = drag, isDrag = dr && dr.id === o.s.id
            const a = isDrag ? dr.curA : o.a, b = isDrag ? dr.curB : o.b
            return (
              <div key={o.s.id} className={'segbar' + (g ? '' : ' indep') + (isDrag ? ' dragging' : '')}
                style={{ gridColumn: `${a + 1}/${b + 2}`, gridRow: o.L + 2, background: g ? g.color || '#2a9d9d' : undefined }}
                title={o.s.label + (g ? ` · ${g.name}` : ' · on their own') + (o.s.note ? ' · has a note' : '')}
                onPointerDown={e => onDown(e, o, 'move')} role="button" tabIndex={0}
                onKeyDown={e => { if (e.key === 'Enter') setEditing(o.s) }}>
                <span className="seg-grip l" onPointerDown={e => onDown(e, o, 'l')} />
                {g && <span className="segav">{initials(g.name)}</span>}
                <span className="seg-lbl">{o.s.label}</span>
                {o.s.note && <span className="seg-noteflag" title="Has a note">✎</span>}
                <span className="seg-grip r" onPointerDown={e => onDown(e, o, 'r')} />
              </div>
            )
          })}
        </div>
      </div>
      {segments.length === 0 && <p className="muted small" style={{ margin: '10px 0 0' }}>No segments yet. Click <b>Add segment</b> to mark guided days and days on their own.</p>}
      {placedIn.length > 0 && (
        <div className="seglegend">
          {Object.entries(guideDays).map(([k, v]) => k
            ? <span key={k}><span className="segswatch" style={{ background: guideById[k]?.color || '#2a9d9d' }} />{guideById[k]?.name ?? 'Guide'} · {v}d with group</span>
            : <span key="own"><span className="segswatch" style={{ background: '#d7d9d2' }} />On their own · {v}d</span>)}
        </div>
      )}
      {editing && <SegmentModal seg={editing} days={days} guides={guides} onClose={() => setEditing(null)}
        onSave={async s => { await run(() => saveSegment(tenant.id, trip.id, s)); setEditing(null) }}
        onDelete={() => window.confirm(`Delete “${editing.label}”?`) && run(() => deleteSegment(tenant.id, editing.id)).then(() => setEditing(null)).catch(() => {})} />}
    </div>
  )
}
