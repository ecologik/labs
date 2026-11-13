import { useState } from 'react'
import { updateTrip } from '../lib/data'
import { callDrive, tripFolder } from '../lib/drive'

// Link the trip to its Google Drive folder ("<Trip> | <Month Year>" in the year folder):
// finds it if it exists, otherwise offers to create it.
export default function DriveFolderButton({ tenant, trip, reload }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const target = tripFolder(trip)
  const save = folder => updateTrip(tenant.id, trip, {}, { drive_folder: { id: folder.id, name: folder.name, url: folder.url } }).then(reload)
  const go = async () => {
    setBusy(true); setErr(null)
    try {
      const found = await callDrive(tenant.id, 'find_folder', { name: target.name, year: target.year })
      if (found.folder) { await save(found.folder); return }
      if (!window.confirm(`No folder called “${target.name}” in ${target.year} yet. Create it in Google Drive?`)) return
      const made = await callDrive(tenant.id, 'find_folder', { name: target.name, year: target.year, create: true })
      await save(made.folder)
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  if (!target) return <span className="muted small" title="Add the trip's dates or tour name first">No Drive folder (add dates first)</span>
  return (
    <>
      <button className="linkbtn ext-link drive-btn" disabled={busy} onClick={go} title={`Find or create “${target.name}” in ${target.year}`}>
        {busy ? 'Looking in Drive…' : '＋ Drive folder'}
      </button>
      {err && <span className="err small">{err}</span>}
    </>
  )
}
