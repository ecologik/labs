// Google Drive (module: drive). Calls the "drive" Supabase Edge Function, which talks to
// the tenant's Shared Drive with the app's service account. Staff only (checked there).
import { supabase } from './supabase'

export async function callDrive(tenantId, action, params = {}) {
  const { data, error } = await supabase.functions.invoke('drive', { body: { tenant_id: tenantId, action, ...params } })
  if (error) {
    let msg = error.message
    try { const j = await error.context?.json(); if (j?.error) msg = j.error } catch { /* keep the generic message */ }
    if (/Failed to send a request|Function not found|404/i.test(msg)) msg = "The Drive connection isn't set up yet (the 'drive' function isn't deployed)."
    throw new Error(msg)
  }
  return data
}

export const folderUrl = id => `https://drive.google.com/drive/folders/${id}`
export const base64ToBuffer = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
// Bella's convention: "<Trip name> | <Month Year>" inside the travel year's folder.
export function tripFolder(trip) {
  const d = trip.details || {}
  let label = (d.tour_name || '').replace(/,\s*/, ' ').trim()
  let year = label.match(/\b(20\d\d)\b/)?.[1]
  if (trip.start_date) {
    const [y, m] = trip.start_date.split('-').map(Number)
    year = String(y)
    if (!label) label = `${MONTHS[m - 1]} ${y}`
  }
  if (!year) return null
  const name = `${trip.name.split('|')[0].trim()} | ${label || year}`.replace(/[/\\]/g, '-')
  return { name, year }
}

// ---------- files in a folder (heritage research folders) ----------
export const folderIdFromUrl = url => String(url || '').match(/\/folders\/([\w-]{10,})/)?.[1] || String(url || '').match(/[?&]id=([\w-]{10,})/)?.[1] || null
export const MAX_FILE_MB = 20

export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] || '')
    r.onerror = () => reject(new Error(`Couldn't read ${file.name}`))
    r.readAsDataURL(file)
  })
}

export async function uploadToFolder(tenantId, folderId, file) {
  if (file.size > MAX_FILE_MB * 1024 * 1024) throw new Error(`${file.name} is over ${MAX_FILE_MB} MB: add it in Google Drive instead.`)
  const data_base64 = await fileToBase64(file)
  return callDrive(tenantId, 'upload', { folder_id: folderId, name: file.name, mime_type: file.type || 'application/octet-stream', data_base64 })
}

// Fetches the file through the app and hands it to the browser as a download.
export async function downloadFile(tenantId, fileId) {
  const r = await callDrive(tenantId, 'download', { file_id: fileId })
  const url = URL.createObjectURL(new Blob([base64ToBuffer(r.data_base64)], { type: r.mime_type }))
  const a = document.createElement('a'); a.href = url; a.download = r.name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
  return r.name
}

// Default name for the heritage research folder inside the trip's folder (tenant can override).
export const heritageFolderName = tenant => tenant.settings?.drive?.heritage_folder_name || 'Heritage Research'
