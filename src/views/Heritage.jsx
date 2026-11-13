import { useCallback, useEffect, useRef, useState } from 'react'
import { updateTrip } from '../lib/data'
import { callDrive, downloadFile, folderIdFromUrl, heritageFolderName, MAX_FILE_MB, uploadToFolder } from '../lib/drive'
import { daysFromToday, fmtRange } from '../lib/format'
import { useSession } from '../lib/session'
import { Avatar, Empty } from './common'
import DrivePicker from './DrivePicker'

const FOLDER = 'application/vnd.google-apps.folder'
const isHeritage = t => Boolean(t.details?.heritage)

const kindIcon = m => m === FOLDER ? '📁' : m.startsWith('image/') ? '🖼️' : m === 'application/pdf' ? '📕'
  : /spreadsheet|excel|csv/.test(m) ? '📊' : /video\//.test(m) ? '🎞️' : /audio\//.test(m) ? '🎧' : '📄'
const fmtSize = b => !b ? '' : b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`
const fmtWhen = s => s ? new Date(s).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : ''

// The research folder in the app: browse, download and upload without leaving the dash.
export function ResearchFolder({ tenant, trip, folder, onClose }) {
  const [path, setPath] = useState([folder])
  const [files, setFiles] = useState(null)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(null)        // file id being downloaded
  const [ups, setUps] = useState([])            // [{ name, state: 'up'|'done'|'err', msg }]
  const [drag, setDrag] = useState(false)
  const input = useRef(null)
  const here = path[path.length - 1]

  const load = useCallback(() => {
    setErr(null)
    return callDrive(tenant.id, 'files', { folder_id: here.id }).then(r => setFiles(r.files)).catch(e => setErr(e.message))
  }, [tenant.id, here.id])
  useEffect(() => { load() }, [load])

  const open = f => { setFiles(null); setPath(p => [...p, { id: f.id, name: f.name, url: f.webViewLink }]) }
  const up = i => { setFiles(null); setPath(p => p.slice(0, i + 1)) }
  const download = async f => {
    setBusy(f.id); setErr(null)
    try { await downloadFile(tenant.id, f.id) } catch (e) { setErr(e.message) } finally { setBusy(null) }
  }
  const trash = async f => {
    if (!window.confirm(`Delete “${f.name}”? It goes to Google Drive's trash, where it can be restored for 30 days.`)) return
    setBusy(f.id); setErr(null)
    try { await callDrive(tenant.id, 'trash', { file_id: f.id, folder_id: here.id }); await load() } catch (e) { setErr(e.message) } finally { setBusy(null) }
  }
  const upload = async list => {
    const arr = Array.from(list || [])
    if (!arr.length) return
    setUps(u => [...u.filter(x => x.state === 'up'), ...arr.map(f => ({ name: f.name, state: 'up' }))])
    for (const f of arr) {
      try { await uploadToFolder(tenant.id, here.id, f); setUps(u => u.map(x => x.name === f.name && x.state === 'up' ? { ...x, state: 'done' } : x)) }
      catch (e) { setUps(u => u.map(x => x.name === f.name && x.state === 'up' ? { ...x, state: 'err', msg: e.message } : x)) }
    }
    load()
  }
  const uploading = ups.some(u => u.state === 'up')

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className={'modal rf' + (drag ? ' drag' : '')} onClick={e => e.stopPropagation()} role="dialog" aria-label="Research folder"
        onDragOver={e => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)}
        onDrop={e => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files) }}>
        <div className="modal-top">
          <div><h2>Research folder</h2><div className="muted small">{trip.name}</div></div>
          <button type="button" className="modal-x" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="rf-bar">
          <div className="dp-path">
            {path.map((p, i) => <span key={p.id}>{i > 0 && ' › '}{i < path.length - 1 ? <button className="linkbtn" onClick={() => up(i)}>{p.name}</button> : <b>{p.name}</b>}</span>)}
          </div>
          <span className="push" />
          {here.url && <a className="linkbtn subtle small" href={here.url} target="_blank" rel="noreferrer">Open in Google Drive ↗</a>}
          <button className="btn sm" disabled={uploading} onClick={() => input.current?.click()}>{uploading ? 'Uploading…' : '⬆ Upload files'}</button>
          <input ref={input} type="file" multiple hidden onChange={e => { upload(e.target.files); e.target.value = '' }} />
        </div>
        {ups.length > 0 && (
          <ul className="rf-ups">
            {ups.map((u, i) => <li key={i} className={u.state}>{u.state === 'up' ? '⏳' : u.state === 'done' ? '✓' : '⚠'} {u.name}{u.msg && <span className="err small"> {u.msg}</span>}</li>)}
          </ul>
        )}
        {err && <p className="err">{err}</p>}
        <div className="rf-list">
          {!files && !err && <p className="muted small">Loading…</p>}
          {files && !files.length && <p className="muted small rf-empty">Nothing here yet. Drop photos, PDFs or documents here, or use Upload files.</p>}
          {files?.map(f => f.mimeType === FOLDER
            ? <button key={f.id} className="rf-row folder" onClick={() => open(f)}>
                <span className="dp-ic" aria-hidden="true">📁</span><span className="rf-name">{f.name}</span><span className="muted small">›</span>
              </button>
            : <div key={f.id} className="rf-row">
                <span className="dp-ic" aria-hidden="true">{kindIcon(f.mimeType)}</span>
                <span className="rf-name">{f.name}</span>
                <span className="muted small rf-meta">{[fmtSize(Number(f.size)), fmtWhen(f.modifiedTime)].filter(Boolean).join(' · ')}</span>
                {f.webViewLink && <a className="linkbtn subtle small" href={f.webViewLink} target="_blank" rel="noreferrer">View</a>}
                <button className="linkbtn small" disabled={busy === f.id} onClick={() => download(f)}>{busy === f.id ? 'Downloading…' : 'Download'}</button>
                <button className="linkbtn subtle small danger-txt" disabled={busy === f.id} onClick={() => trash(f)} aria-label={`Delete ${f.name}`}>Delete</button>
              </div>)}
        </div>
        <p className="muted small" style={{ margin: 0 }}>Drag files onto this window to upload them (up to {MAX_FILE_MB} MB each). Everything is saved in the trip's Google Drive folder.</p>
      </div>
    </div>
  )
}

// Open the trip's research folder, or link one: find/create "Heritage Research" inside the
// trip's Drive folder, or pick any folder in the drive.
export function ResearchFolderButton({ tenant, trip, reload, big, onChange }) {
  const { hasModule } = useSession()
  const d = trip.details || {}
  const [open, setOpen] = useState(null)        // folder to show
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const drive = hasModule('drive')
  const linked = d.heritage_folder
  const linkedId = linked?.id || folderIdFromUrl(linked?.url)
  const name = heritageFolderName(tenant)
  const save = f => updateTrip(tenant.id, trip, {}, { heritage_folder: { id: f.id, name: f.name, url: f.url } }).then(reload)
  const run = async fn => { setBusy(true); setErr(null); try { await fn() } catch (e) { setErr(e.message) } finally { setBusy(false) } }

  const openIt = () => run(async () => {
    if (linked?.id && linked?.name) { setOpen(linked); return }
    const r = await callDrive(tenant.id, 'folder', { folder_id: linkedId })   // a pasted link: look it up once and save it
    await save(r.folder); setOpen(r.folder)
  })
  const inTripFolder = () => run(async () => {
    const found = await callDrive(tenant.id, 'subfolder', { parent_id: d.drive_folder.id, name })
    if (found.folder) { await save(found.folder); setOpen(found.folder); return }
    if (!window.confirm(`There's no “${name}” folder inside “${d.drive_folder.name}” yet. Create it?`)) return
    const made = await callDrive(tenant.id, 'subfolder', { parent_id: d.drive_folder.id, name, create: true })
    await save(made.folder); setOpen(made.folder)
  })

  const cls = big ? 'btn' : 'linkbtn ext-link drive-btn'
  let body
  if (linked && drive && linkedId) body = (
    <span className="rf-link">
      <button className={big ? 'btn' : 'linkbtn ext-link'} disabled={busy} onClick={openIt}>{busy ? 'Opening…' : big ? 'Open research folder ›' : 'Research folder'}</button>
      {big && <button className="linkbtn subtle small" disabled={busy} onClick={() => setPicking(true)}>Change folder</button>}
    </span>
  )
  else if (linked) body = linked.url ? <a className={big ? 'btn ghost' : 'ext-link'} href={linked.url} target="_blank" rel="noreferrer">Research folder ↗</a> : null
  else if (!drive) body = <span className="muted small">No research folder yet: add its link in Edit trip details.</span>
  else body = (
    <span className="rf-link">
      {d.drive_folder?.id
        ? <button className={cls} disabled={busy} onClick={inTripFolder} title={`Find or create “${name}” in the trip's folder`}>{busy ? 'Looking in Drive…' : `＋ ${name} folder`}</button>
        : <span className="muted small">Link the trip's Drive folder first, or</span>}
      <button className="linkbtn subtle small" disabled={busy} onClick={() => setPicking(true)}>{d.drive_folder?.id ? 'or pick another folder' : 'pick a folder'}</button>
    </span>
  )
  return (
    <>
      {body}
      {err && <span className="err small">{err}</span>}
      {picking && <DrivePicker tenantId={tenant.id} mode="folder" title="Pick the research folder" onClose={() => setPicking(false)}
        start={d.drive_folder?.id ? { id: d.drive_folder.id, name: d.drive_folder.name } : null}
        onPick={async ({ folder }) => { const r = await callDrive(tenant.id, 'folder', { folder_id: folder.id }); await save(r.folder); setPicking(false); setOpen(r.folder) }} />}
      {open && <ResearchFolder tenant={tenant} trip={trip} folder={open} onClose={() => { setOpen(null); onChange?.() }} />}
    </>
  )
}

// Heritage Trips: every heritage trip with its research folder, soonest first.
export default function HeritageView({ tenant, trips, teamById, openTrip, reload }) {
  const { hasModule } = useSession()
  const [counts, setCounts] = useState({})
  const folderOf = t => t.details?.heritage_folder?.id || folderIdFromUrl(t.details?.heritage_folder?.url)
  const ids = trips.filter(isHeritage).map(folderOf).filter(Boolean).sort().join(',')
  const driveOn = hasModule('drive')
  const loadCounts = useCallback(() => {
    if (!driveOn || !ids) return
    callDrive(tenant.id, 'counts', { folder_ids: ids.split(',') }).then(r => setCounts(c => ({ ...c, ...r.counts }))).catch(() => {})
  }, [tenant.id, ids, driveOn])
  useEffect(() => { loadCounts() }, [loadCounts])
  const list = trips.filter(isHeritage).sort((a, b) => {
    const da = daysFromToday(a.end_date ?? a.start_date), db = daysFromToday(b.end_date ?? b.start_date)
    const pa = da != null && da < 0, pb = db != null && db < 0      // past trips go last
    return Number(pa) - Number(pb) || (a.start_date || '9999').localeCompare(b.start_date || '9999') * (pa ? -1 : 1)
  })
  return (
    <div className="view">
      <div className="card intro">Heritage trips and their research folders: ancestry photos, gravestones and records. Open a folder to view, download or upload files; everything is saved in Google Drive. To mark a trip as heritage, open it and use <b>Edit trip details</b>.</div>
      {!list.length && <Empty>No heritage trips yet.</Empty>}
      {list.map(t => {
        const d = t.details || {}, lead = teamById[t.lead_id], out = daysFromToday(t.start_date), back = daysFromToday(t.end_date ?? t.start_date)
        const pax = d.pax_max || d.pax_min
        return (
          <div key={t.id} className="card her-card">
            <div className="her-main">
              <button className="her-name" onClick={() => openTrip(t.id)}><span className="her-star">✦</span> {t.name}</button>
              <div className="her-meta">
                {t.start_date && <span>{fmtRange(t.start_date, t.end_date)}</span>}
                {out != null && out > 0 && <b>{out} day{out === 1 ? '' : 's'} out</b>}
                {out != null && out <= 0 && back >= 0 && <b>on the ground</b>}
                {lead && <span className="her-lead"><Avatar member={lead} sm /> {lead.name.split(' ')[0]}{pax ? ` · ${pax} pax` : ''}</span>}
              </div>
              <div className="her-folder muted small">📁 {d.heritage_folder?.name || (d.heritage_folder?.url ? 'Linked folder' : 'No research folder yet')}
                {counts[folderOf(t)] != null && <span className={'her-count' + (counts[folderOf(t)] ? '' : ' zero')}>{counts[folderOf(t)]} file{counts[folderOf(t)] === 1 ? '' : 's'}</span>}</div>
            </div>
            <div className="her-act"><ResearchFolderButton tenant={tenant} trip={t} reload={reload} onChange={loadCounts} big /></div>
          </div>
        )
      })}
    </div>
  )
}
