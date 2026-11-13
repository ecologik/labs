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
