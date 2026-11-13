import { useEffect, useState } from 'react'
import { callDrive } from '../lib/drive'

const FOLDER = 'application/vnd.google-apps.folder'
const icon = f => (f.mimeType === FOLDER ? '📁' : '📄')

// Browse the trips Shared Drive (years → client folders → docs) and pick the Client File.
// onPick receives { file, folder } where folder is the doc's parent folder { id, name }.
// mode="folder": only folders are shown and the open folder is picked ({ folder }).
export default function DrivePicker({ tenantId, onPick, onClose, mode = 'file', start = null, title }) {
  const folderMode = mode === 'folder'
  const [path, setPath] = useState(start ? [{ id: null, name: 'Trips drive' }, start] : [{ id: null, name: 'Trips drive' }])
  const [files, setFiles] = useState(null)
  const [err, setErr] = useState(null)
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(null)
  const here = path[path.length - 1]

  useEffect(() => {
    let live = true
    callDrive(tenantId, 'browse', here.id ? { folder_id: here.id } : {})
      .then(r => { if (live) setFiles(r.files) }).catch(e => { if (live) setErr(e.message) })
    return () => { live = false }
  }, [tenantId, here.id])

  const open = f => { setFiles(null); setErr(null); setQ(''); setPath(p => [...p, { id: f.id, name: f.name }]) }
  const up = i => { setFiles(null); setErr(null); setQ(''); setPath(p => p.slice(0, i + 1)) }
  const pick = async f => {
    setBusy(f.id); setErr(null)
    try { await onPick({ file: f, folder: path.length > 1 ? here : null }) } catch (e) { setErr(e.message) } finally { setBusy(null) }
  }
  const pickHere = async () => {
    setBusy(here.id); setErr(null)
    try { await onPick({ folder: here }) } catch (e) { setErr(e.message) } finally { setBusy(null) }
  }
  const shown = (files || []).filter(f => !folderMode || f.mimeType === FOLDER).filter(f => !q.trim() || f.name.toLowerCase().includes(q.trim().toLowerCase()))

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal drive-picker" onClick={e => e.stopPropagation()} role="dialog" aria-label={title || 'Pick the client file from Google Drive'}>
        <div className="modal-top"><h2>{title || 'Pick the client file'}</h2><button type="button" className="modal-x" onClick={onClose} aria-label="Close">×</button></div>
        <div className="dp-path">
          {path.map((p, i) => <span key={i}>{i > 0 && ' › '}{i < path.length - 1 ? <button className="linkbtn" onClick={() => up(i)}>{p.name}</button> : <b>{p.name}</b>}</span>)}
        </div>
        {folderMode && path.length > 1 && (
          <div className="dp-usehere"><span>📁 <b>{here.name}</b></span>
            <button className="btn sm" disabled={Boolean(busy)} onClick={pickHere}>{busy === here.id ? 'Linking…' : 'Use this folder'}</button></div>
        )}
        {files && files.length > 8 && <input className="dp-search" type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Search this folder" autoFocus />}
        {err && <p className="err">{err}</p>}
        <div className="dp-list">
          {!files && !err && <p className="muted small">Loading…</p>}
          {files && !shown.length && <p className="muted small">{q ? 'Nothing matches.' : folderMode ? 'No folders inside this one.' : 'This folder is empty.'}</p>}
          {shown.map(f => (
            <button key={f.id} className={'dp-row' + (f.mimeType === FOLDER ? ' folder' : ' doc')} disabled={Boolean(busy)}
              onClick={() => (f.mimeType === FOLDER ? open(f) : pick(f))}>
              <span className="dp-ic" aria-hidden="true">{icon(f)}</span>
              <span className="dp-name">{f.name}</span>
              <span className="muted small">{busy === f.id ? 'Reading…' : f.mimeType === FOLDER ? '›' : 'Use this file'}</span>
            </button>
          ))}
        </div>
        <p className="muted small" style={{ margin: 0 }}>{folderMode
          ? 'Open the folder you want, then click “Use this folder”.'
          : "Open the year, then the client's folder, then click the Client File (Google Doc or Word)."}</p>
      </div>
    </div>
  )
}
