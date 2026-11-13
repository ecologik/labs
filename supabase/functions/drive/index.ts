// EcoLogik Labs: Google Drive bridge (Supabase Edge Function "drive").
//
// The app's Google service account (secret GOOGLE_SERVICE_ACCOUNT, the JSON key) is a member
// of the tenant's Shared Drive. This function lets signed-in STAFF of that tenant:
//   browse       { folder_id? }   list year folders (no folder_id) or a folder's subfolders + docs
//   client_file  { file_id }      the Client File as .docx bytes (Google Docs are exported)
//   find_folder  { name, year, create? }  find (or create) "<name>" inside the year folder
//   folder       { folder_id }    a folder's name + link (to link a folder pasted as a link)
//   subfolder    { parent_id, name, create? }  find (or create) a folder inside another one
//   files        { folder_id }    everything in a folder (research folders: photos, PDFs, docs…)
//   counts       { folder_ids }   how many files (not subfolders) sit directly in each folder
//   download     { file_id }      a file's bytes (Google Docs/Sheets/Slides are exported)
//   upload       { folder_id, name, mime_type, data_base64 }  add a file to a folder
// The Shared Drive is named in tenants.settings.drive.name (e.g. "01 | Trips").
// Everything stays inside that one drive: ids from elsewhere are refused.
//
// Single file on purpose, so it can be pasted into the Supabase dashboard editor.
import { createClient } from 'npm:@supabase/supabase-js@2'

const DRIVE = 'https://www.googleapis.com/drive/v3'
const FOLDER = 'application/vnd.google-apps.folder'
const GDOC = 'application/vnd.google-apps.document'
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const MAX_BYTES = 20 * 1024 * 1024
// Google's own formats can't be downloaded as-is: export them to the nearest Office/PDF format.
const EXPORTS: Record<string, [string, string]> = {
  [GDOC]: [DOCX, '.docx'],
  'application/vnd.google-apps.spreadsheet': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.xlsx'],
  'application/vnd.google-apps.presentation': ['application/pdf', '.pdf'],
  'application/vnd.google-apps.drawing': ['image/png', '.png'],
}
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

class HttpError extends Error {
  status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}

// ---------- Google auth (service account → access token), cached per instance ----------
export const toBase64 = (buf: Uint8Array) => {
  let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000))
  return btoa(s)
}
const b64url = (b: ArrayBuffer | Uint8Array | string) => {
  const bytes = typeof b === 'string' ? new TextEncoder().encode(b) : new Uint8Array(b as ArrayBuffer)
  let s = ''; for (const x of bytes) s += String.fromCharCode(x)
  return btoa(s).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
}
let cached: { token: string, exp: number } | null = null
export async function googleToken(sa: { client_email: string, private_key: string, token_uri?: string }, fetchFn = fetch) {
  const now = Math.floor(Date.now() / 1000)
  if (cached && cached.exp > now + 60) return cached.token
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = b64url(JSON.stringify({
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/drive',
    aud: sa.token_uri || 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  }))
  const pem = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
  const der = Uint8Array.from(atob(pem), c => c.charCodeAt(0))
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${claims}`))
  const res = await fetchFn(sa.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${header}.${claims}.${b64url(sig)}` }),
  })
  const j = await res.json()
  if (!res.ok) throw new HttpError(502, `Google sign-in failed: ${j.error_description || j.error || res.status}`)
  cached = { token: j.access_token, exp: now + (j.expires_in || 3600) }
  return cached.token
}

// ---------- Drive calls ----------
export function driveApi(token: string, fetchFn = fetch) {
  const call = async (path: string, params: Record<string, string> = {}, init: RequestInit = {}) => {
    const q = new URLSearchParams({ supportsAllDrives: 'true', ...params })
    const res = await fetchFn(`${DRIVE}${path}?${q}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) } })
    if (!res.ok) {
      let msg = String(res.status)
      try { const j = await res.json(); msg = j.error?.message || msg } catch { /* not json */ }
      throw new HttpError(res.status === 404 ? 404 : 502, `Google Drive: ${msg}`)
    }
    return res
  }
  const list = async (q: string, driveId: string, fields = 'id,name,mimeType,modifiedTime,webViewLink') => {
    const out: any[] = []
    let pageToken = ''
    do {
      const p: Record<string, string> = { q, corpora: 'drive', driveId, includeItemsFromAllDrives: 'true', pageSize: '200',
        orderBy: 'name', fields: `nextPageToken,files(${fields})` }
      if (pageToken) p.pageToken = pageToken
      const j = await (await call('/files', p)).json()
      out.push(...(j.files || [])); pageToken = j.nextPageToken || ''
    } while (pageToken && out.length < 2000)
    return out
  }
  return {
    call, list,
    async findDrive(name: string) {
      const all = await (await call('/drives', { pageSize: '100' })).json()
      const d = (all.drives || []).find((x: any) => x.name === name)
      if (!d) throw new HttpError(404, `The app can't see the shared drive "${name}". Add the service account to it as a Content manager.`)
      return d.id as string
    },
    async meta(id: string) {
      return await (await call(`/files/${encodeURIComponent(id)}`, { fields: 'id,name,mimeType,driveId,parents,webViewLink,size' })).json()
    },
    async upload(name: string, mimeType: string, parent: string, bytes: Uint8Array) {
      const boundary = 'labs' + crypto.randomUUID().replace(/-/g, '')
      const enc = new TextEncoder()
      const head = enc.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [parent] })}\r\n` +
        `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`)
      const tail = enc.encode(`\r\n--${boundary}--`)
      const body = new Uint8Array(head.length + bytes.length + tail.length)
      body.set(head); body.set(bytes, head.length); body.set(tail, head.length + bytes.length)
      const q = new URLSearchParams({ uploadType: 'multipart', supportsAllDrives: 'true', fields: 'id,name,mimeType,size,modifiedTime,webViewLink' })
      const res = await fetchFn(`https://www.googleapis.com/upload/drive/v3/files?${q}`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` }, body,
      })
      const j = await res.json()
      if (!res.ok) throw new HttpError(502, `Google Drive: ${j.error?.message || res.status}`)
      return j
    },
    async createFolder(name: string, parent: string) {
      return await (await call('/files', { fields: 'id,name,mimeType,webViewLink' }, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, mimeType: FOLDER, parents: [parent] }),
      })).json()
    },
  }
}
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")

// ---------- actions ----------
export async function handle(body: any, ctx: { drive: ReturnType<typeof driveApi>, driveName: string }) {
  const { drive } = ctx
  const driveId = await drive.findDrive(ctx.driveName)
  const inDrive = async (id: string) => {
    if (typeof id !== 'string' || !/^[\w-]{10,100}$/.test(id)) throw new HttpError(400, 'Bad id')
    const m = await drive.meta(id)
    if (m.driveId !== driveId) throw new HttpError(403, 'That file is not in the trips drive.')
    return m
  }
  const folderIn = async (id: string) => {
    const m = await inDrive(id)
    if (m.mimeType !== FOLDER) throw new HttpError(400, 'That is not a folder.')
    return m
  }
  const cleanName = (n: unknown) => {
    const name = String(n ?? '').replace(/[\/\\\u0000-\u001f]/g, '-').trim()
    if (!name || name.length > 200) throw new HttpError(400, 'Bad name')
    return name
  }
  const yearFolder = async (year: string, create: boolean) => {
    if (!/^\d{4}$/.test(String(year))) throw new HttpError(400, 'Bad year')
    const hit = (await drive.list(`'${driveId}' in parents and mimeType = '${FOLDER}' and name = '${year}' and trashed = false`, driveId))[0]
    if (hit) return hit
    return create ? await drive.createFolder(String(year), driveId) : null
  }

  switch (body.action) {
    case 'browse': {
      const parent = body.folder_id ? (await inDrive(body.folder_id)).id : driveId
      const files = await drive.list(`'${parent}' in parents and trashed = false and (mimeType = '${FOLDER}' or mimeType = '${GDOC}' or mimeType = '${DOCX}')`, driveId)
      files.sort((a, b) => Number(b.mimeType === FOLDER) - Number(a.mimeType === FOLDER) || a.name.localeCompare(b.name))
      return { folder_id: body.folder_id || null, files }
    }
    case 'client_file': {
      const m = await inDrive(body.file_id)
      if (m.mimeType !== GDOC && m.mimeType !== DOCX) throw new HttpError(400, 'Pick a Google Doc or Word file.')
      if (m.size && Number(m.size) > 15 * 1024 * 1024) throw new HttpError(400, 'That file is over 15 MB.')
      const res = m.mimeType === GDOC
        ? await drive.call(`/files/${m.id}/export`, { mimeType: DOCX })
        : await drive.call(`/files/${m.id}`, { alt: 'media' })
      return { name: m.name, url: m.webViewLink, parent: m.parents?.[0] || null, docx_base64: toBase64(new Uint8Array(await res.arrayBuffer())) }
    }
    case 'find_folder': {
      const name = String(body.name || '').trim()
      if (!name || name.length > 200 || /[\/\\]/.test(name)) throw new HttpError(400, 'Bad folder name')
      const y = await yearFolder(body.year, Boolean(body.create))
      if (!y) return { folder: null }
      const hit = (await drive.list(`'${y.id}' in parents and mimeType = '${FOLDER}' and name = '${esc(name)}' and trashed = false`, driveId))[0]
      if (hit) return { folder: { id: hit.id, name: hit.name, url: hit.webViewLink }, created: false }
      if (!body.create) return { folder: null }
      const f = await drive.createFolder(name, y.id)
      return { folder: { id: f.id, name: f.name, url: f.webViewLink }, created: true }
    }
    case 'folder': {   // details of one folder (to link an existing folder by its link)
      const m = await inDrive(body.folder_id)
      if (m.mimeType !== FOLDER) throw new HttpError(400, 'That link is not a folder.')
      return { folder: { id: m.id, name: m.name, url: m.webViewLink } }
    }
    case 'subfolder': {
      const parent = await folderIn(body.parent_id)
      const name = cleanName(body.name)
      const hit = (await drive.list(`'${parent.id}' in parents and mimeType = '${FOLDER}' and name = '${esc(name)}' and trashed = false`, driveId))[0]
      if (hit) return { folder: { id: hit.id, name: hit.name, url: hit.webViewLink }, created: false }
      if (!body.create) return { folder: null }
      const f = await drive.createFolder(name, parent.id)
      return { folder: { id: f.id, name: f.name, url: f.webViewLink }, created: true }
    }
    case 'files': {
      const m = await folderIn(body.folder_id)
      const files = await drive.list(`'${m.id}' in parents and trashed = false`, driveId, 'id,name,mimeType,size,modifiedTime,webViewLink,thumbnailLink')
      files.sort((a, b) => Number(b.mimeType === FOLDER) - Number(a.mimeType === FOLDER) || a.name.localeCompare(b.name))
      return { folder: { id: m.id, name: m.name, url: m.webViewLink }, files }
    }
    case 'counts': {
      const ids = Array.isArray(body.folder_ids) ? body.folder_ids.filter((x: unknown) => typeof x === 'string' && /^[\w-]{10,100}$/.test(x)).slice(0, 60) : []
      // corpora=drive limits every listing to the trips drive, so ids from elsewhere just count 0.
      const counts: Record<string, number> = {}
      await Promise.all(ids.map(async (id: string) => {
        counts[id] = (await drive.list(`'${id}' in parents and trashed = false and mimeType != '${FOLDER}'`, driveId, 'id')).length
      }))
      return { counts }
    }
    case 'download': {
      const m = await inDrive(body.file_id)
      if (m.mimeType === FOLDER) throw new HttpError(400, 'That is a folder.')
      if (m.size && Number(m.size) > MAX_BYTES) throw new HttpError(400, 'That file is over 20 MB: open it in Google Drive instead.')
      const exp = EXPORTS[m.mimeType]
      if (!exp && m.mimeType.startsWith('application/vnd.google-apps.')) throw new HttpError(400, 'This kind of Google file can only be opened in Google Drive.')
      const res = exp ? await drive.call(`/files/${m.id}/export`, { mimeType: exp[0] }) : await drive.call(`/files/${m.id}`, { alt: 'media' })
      const buf = new Uint8Array(await res.arrayBuffer())
      if (buf.length > MAX_BYTES) throw new HttpError(400, 'That file is over 20 MB: open it in Google Drive instead.')
      const name = exp && !m.name.toLowerCase().endsWith(exp[1]) ? m.name + exp[1] : m.name
      return { name, mime_type: exp ? exp[0] : m.mimeType, data_base64: toBase64(buf) }
    }
    case 'upload': {
      const parent = await folderIn(body.folder_id)
      const name = cleanName(body.name)
      const mime = typeof body.mime_type === 'string' && /^[\w.+-]+\/[\w.+-]+$/.test(body.mime_type) && !body.mime_type.startsWith('application/vnd.google-apps.')
        ? body.mime_type : 'application/octet-stream'
      if (typeof body.data_base64 !== 'string') throw new HttpError(400, 'No file')
      let bytes: Uint8Array
      try { bytes = Uint8Array.from(atob(body.data_base64), c => c.charCodeAt(0)) } catch { throw new HttpError(400, 'Bad file data') }
      if (bytes.length > MAX_BYTES) throw new HttpError(400, 'Files over 20 MB have to be added in Google Drive.')
      const f = await drive.upload(name, mime, parent.id, bytes)
      return { file: f }
    }
    default: throw new HttpError(400, 'Unknown action')
  }
}

// ---------- HTTP entry: only staff of the tenant, only if the tenant has a drive set up ----------
async function serve(req: Request) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'POST only')
    const body = await req.json()
    const auth = req.headers.get('Authorization') || ''
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } })
    const { data: staff, error: e1 } = await sb.rpc('is_staff', { t: body.tenant_id })
    if (e1 || !staff) throw new HttpError(403, 'Only staff can use Drive.')
    const { data: tenant, error: e2 } = await sb.from('tenants').select('modules, settings').eq('id', body.tenant_id).single()
    if (e2 || !tenant) throw new HttpError(403, 'Unknown organization')
    const driveName = tenant.settings?.drive?.name
    if (!tenant.modules?.drive || !driveName) throw new HttpError(400, 'Google Drive is not set up for this organization.')
    const raw = Deno.env.get('GOOGLE_SERVICE_ACCOUNT')
    if (!raw) throw new HttpError(500, 'The GOOGLE_SERVICE_ACCOUNT secret is missing.')
    const token = await googleToken(JSON.parse(raw))
    return json(await handle(body, { drive: driveApi(token), driveName }))
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500
    if (status === 500) console.error(e)
    return json({ error: e instanceof Error ? e.message : String(e) }, status)
  }
}

if (typeof Deno !== 'undefined') Deno.serve(serve)
