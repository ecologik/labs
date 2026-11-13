// Client file import: reads the Word intake document the team keeps in each client's
// Drive folder and turns it into the fields of a new trip. Everything happens in the
// browser; the file itself is never uploaded or stored.
//
// The document is a list of "Label: value" lines (some values are Word dropdowns).
// parseClientText() works on plain text, so a Google Drive export can reuse it later.
import { unzipSync, strFromU8 } from 'fflate'

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const TABLE = '\u241e'   // marks where a table starts: the intake fields end there

// .docx → plain text: paragraphs and line breaks become newlines, dropdown values included.
export function docxToText(buf) {
  let files
  try { files = unzipSync(new Uint8Array(buf), { filter: f => f.name === 'word/document.xml' }) }
  catch { throw new Error("That file couldn't be opened. Pick the Word (.docx) client file.") }
  const xml = files['word/document.xml']
  if (!xml) throw new Error("That doesn't look like a Word document. Pick the .docx client file.")
  const doc = new DOMParser().parseFromString(strFromU8(xml), 'application/xml')
  const body = doc.getElementsByTagNameNS(W, 'body')[0]
  if (!body) throw new Error("That Word document couldn't be read.")
  let out = ''
  const walk = node => {
    for (const n of node.childNodes) {
      if (n.nodeType !== 1) continue
      if (n.namespaceURI === W) {
        if (n.localName === 't') { out += n.textContent; continue }
        if (n.localName === 'br' || n.localName === 'cr') { out += '\n'; continue }
        if (n.localName === 'tab') { out += ' '; continue }
        if (n.localName === 'sdtPr' || n.localName === 'rPr' || n.localName === 'pPr' || n.localName === 'instrText') continue
        if (n.localName === 'del') continue                     // tracked deletions
      }
      if (n.namespaceURI === W && n.localName === 'tbl') out += '\n' + TABLE + '\n'   // a table starts a new section
      walk(n)
      if (n.namespaceURI === W && (n.localName === 'p' || n.localName === 'tc')) out += '\n'
    }
  }
  walk(body)
  return out
}

// ---------- text → labelled values ----------
const LABELS = [
  ['client', 'Client Name'], ['pax', 'Number of Passengers'], ['type', 'Trip Type'], ['dates', 'Travel Dates'],
  ['destinations', 'Destinations'], ['specialist', 'Travel Specialist'], ['heritage', 'Heritage'], ['leader', 'Tour Leader'],
  ['gift', 'Gift in Room'], ['giftNote', 'Notes regarding gift'], ['notes', 'Notes'],
]
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const LABEL_RE = new RegExp(`(^|\\n)[ \\t]*(${LABELS.map(([, l]) => esc(l).replace(/ /g, '\\s+')).join('|')})[ \\t]*:`, 'gi')
// Template placeholders that mean "not filled in".
const PLACEHOLDERS = [/^(n\/?a|none|tbd|-+)$/i, /^trip type\?$/i, /^heritage\?$/i, /^where is gift\?$/i, /^\[vip\?[^\]]*\]/i, /^select\b.*$/i]

export function splitLabels(text) {
  const t = text.replace(/\r\n?/g, '\n').replace(/ /g, ' ')
  const hits = []
  for (const m of t.matchAll(LABEL_RE)) {
    const label = m[2].replace(/\s+/g, ' ').toLowerCase()
    const key = LABELS.find(([, l]) => l.toLowerCase() === label)[0]
    hits.push({ key, start: m.index + m[1].length, end: m.index + m[0].length })
  }
  const raw = {}
  hits.forEach((h, i) => {
    let v = t.slice(h.end, i + 1 < hits.length ? hits[i + 1].start : t.length).split(TABLE)[0]
    v = v.split('\n').map(x => x.trim()).join('\n').trim()
    for (const p of PLACEHOLDERS) v = v.replace(p, '').trim()
    if (!(h.key in raw)) raw[h.key] = v           // first occurrence wins
  })
  return raw
}

// ---------- value parsers ----------
const fold = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const pad = n => String(n).padStart(2, '0')
const isoOf = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`
const valid = (y, m, d) => { const x = new Date(y, m, d); return x.getFullYear() === y && x.getMonth() === m && x.getDate() === d }
const fullYear = y => (y < 100 ? 2000 + y : y)

// "May 3 - 12, 2027", "May 3, 2027 – June 2, 2027", "3–12 May 2027", "5/3/27 - 5/12/27",
// "2027-05-03 to 2027-05-12", "May 2027". Returns { start, end, month, year } (any may be null).
export function parseTravelDates(s, today = new Date()) {
  const out = { start: null, end: null, month: null, year: null }
  if (!s) return out
  const str = s.replace(/[–—]/g, '-').replace(/(\d)(st|nd|rd|th)\b/gi, '$1')
  const iso = [...str.matchAll(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g)].map(m => [+m[1], +m[2] - 1, +m[3]])
  let parts
  if (iso.length) parts = iso.slice(0, 2).map(([y, m, d]) => ({ y, m, d }))
  else {
    const num = [...str.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g)]
    if (num.length) parts = num.slice(0, 2).map(m => ({ m: +m[1] - 1, d: +m[2], y: m[3] ? fullYear(+m[3]) : null }))
    else {
      const sides = str.split(/\s*(?:\s-\s|-|\bto\b|\bthru\b|\bthrough\b|\buntil\b)\s*/i).filter(x => x.trim()).slice(0, 2)
      parts = sides.map(side => {
        const mo = side.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?/i)
        const yr = side.match(/\b(\d{4})\b|'(\d{2})\b/)
        const day = side.replace(/\b\d{4}\b|'\d{2}\b/g, '').match(/\b(\d{1,2})\b/)
        return { m: mo ? MONTHS.indexOf(mo[1].slice(0, 3).toLowerCase()) : null, d: day ? +day[1] : null, y: yr ? +(yr[1] || 2000 + +yr[2]) : null }
      })
      if (parts.length === 2 && parts[0].m == null && parts[1].m != null) parts[0].m = parts[1].m   // "3-12 May 2027"
    }
  }
  if (!parts?.length) return out
  const [a, b = null] = parts
  if (b) { if (b.m == null) b.m = a.m; if (a.y == null) a.y = b.y; if (b.y == null) b.y = a.y }
  if (a.m == null) return out
  out.month = a.m
  if (a.y == null) {                              // no year written: the next time that date comes round
    const y = today.getFullYear()
    a.y = new Date(y, a.m, a.d || 28) < new Date(today.getFullYear(), today.getMonth(), today.getDate()) ? y + 1 : y
    if (b) b.y = a.y
  }
  out.year = a.y
  if (a.d == null || !valid(a.y, a.m, a.d)) return out
  out.start = isoOf(a.y, a.m, a.d)
  if (b && b.d != null && b.m != null) {
    if (!valid(b.y, b.m, b.d)) return out
    let end = isoOf(b.y, b.m, b.d)
    if (end < out.start && !iso.length) end = isoOf(b.y + 1, b.m, b.d)   // "Dec 28 - Jan 5, 2027"
    out.end = end
  }
  return out
}

export function parsePax(s) {
  if (!s) return { min: null, max: null }
  const r = s.match(/(\d+)\s*(?:-|to)\s*(\d+)/i)
  if (r) { const x = +r[1], y = +r[2]; return { min: Math.min(x, y), max: Math.max(x, y) } }
  const nums = [...s.matchAll(/\d+/g)].map(m => +m[0])
  if (!nums.length) return { min: null, max: null }
  const n = /[+&]|\band\b/i.test(s) ? nums.reduce((a, b) => a + b, 0) : nums[0]
  return { min: n, max: n }
}

// Match a typed name to a person: full name, then a unique first name or surname.
export function matchPerson(value, people) {
  const v = fold(value)
  if (!v) return null
  const list = people.filter(p => p && p.name)
  const exact = list.find(p => fold(p.name) === v) || list.find(p => v.includes(fold(p.name)))
  if (exact) return exact
  const words = new Set(v.split(/[^a-z0-9]+/).filter(w => w.length > 1))
  const hits = list.filter(p => fold(p.name).split(/\s+/).some(w => words.has(w)))
  return hits.length === 1 ? hits[0] : null
}

export function matchTripType(value, types) {
  const v = fold(value)
  if (!v) return null
  const exact = types.find(t => fold(t) === v)
  if (exact) return exact
  const has = (t, ...ws) => ws.some(w => fold(t).includes(w))
  if (/private|custom/.test(v)) return types.find(t => has(t, 'private', 'custom')) || null
  if (/small group|group tour/.test(v)) return types.find(t => has(t, 'group')) || null
  if (/b2b|agent|advisor/.test(v)) return types.find(t => has(t, 'b2b')) || null
  return null
}

export function splitDestinations(value, known) {
  if (!value) return []
  const out = []
  for (const part of value.split(/[,;\n/]|\s+&\s+|\s+and\s+/i)) {
    const x = part.replace(/^[-•*\s]+|[.\s]+$/g, '').replace(/\s*\([^)]*\)\s*$/, '').trim()   // "Rome (pickup at port)" → Rome
    if (!x) continue
    const k = known.find(d => fold(d) === fold(x))
    const name = k || x
    if (!out.some(o => fold(o) === fold(name))) out.push(name)
  }
  return out
}

export function parseGift(value) {
  const v = fold(value)
  if (!v) return null
  if (/^(no|none|n\/a|na)\b/.test(v)) return { kind: 'NA', location: '' }
  const kind = /\bmbv\b/.test(v) && !/non[- ]?mbv/.test(v) ? 'MBV' : 'NonMBV'
  const loc = value.match(/\bin\s+(.+)$/i)
  return { kind, location: loc ? loc[1].trim().replace(/^the\s+/i, '').replace(/^./, c => c.toUpperCase()) : '' }
}

// Labelled text → what the New trip form needs, plus a report of what was found.
// ctx: { tripTypes, destinations, team, guides, flags, gifts (module on?), today }
export function parseClientText(text, ctx) {
  const raw = splitLabels(text)
  const report = []
  const add = (label, value, status, note) => report.push({ label, value, status, note })
  const fields = {}, details = {}

  if (raw.client) { fields.name = raw.client.split('\n')[0].slice(0, 200); add('Client name', fields.name, 'ok', 'Trip name') }
  else add('Client name', '', 'empty')

  if (raw.pax) {
    const p = parsePax(raw.pax)
    if (p.min != null) { details.pax_min = p.min; details.pax_max = p.max; add('Passengers', p.min === p.max ? String(p.min) : `${p.min}–${p.max}`, 'ok') }
    else add('Passengers', raw.pax, 'unmatched', "Couldn't read a number")
  } else add('Passengers', '', 'empty')

  if (raw.type) {
    const t = matchTripType(raw.type, ctx.tripTypes || [])
    if (t) { fields.tripType = t; add('Trip type', raw.type, 'ok', t === raw.type ? null : `Set to ${t}`) }
    else add('Trip type', raw.type, 'unmatched', 'Pick the trip type below')
  } else add('Trip type', '', 'empty')

  if (raw.dates) {
    const d = parseTravelDates(raw.dates, ctx.today)
    if (d.start) { fields.startDate = d.start; if (d.end) fields.endDate = d.end }
    if (d.month != null && d.year) details.tour_name = `${MONTH_NAMES[d.month]}, ${d.year}`
    add('Travel dates', raw.dates, d.start ? 'ok' : 'unmatched', d.start ? null : d.month != null ? `Only the month: tour name set to ${details.tour_name}` : "Couldn't read the dates")
  } else add('Travel dates', '', 'empty')

  if (raw.destinations) {
    const list = splitDestinations(raw.destinations, ctx.destinations || [])
    const fresh = list.filter(x => !(ctx.destinations || []).includes(x))
    details.destinations = list
    add('Destinations', list.join(', '), 'ok', fresh.length ? `New: ${fresh.join(', ')}` : null)
  } else add('Destinations', '', 'empty')

  if (raw.specialist) {
    const m = matchPerson(raw.specialist, ctx.team || [])
    if (m) { fields.leadId = m.id; add('Travel specialist', raw.specialist, 'ok', m.name === raw.specialist ? null : m.name) }
    else add('Travel specialist', raw.specialist, 'unmatched', 'Not on the team list; pick below')
  } else add('Travel specialist', '', 'empty')

  if ((ctx.flags || []).some(f => f.key === 'heritage')) {
    const v = fold(raw.heritage)
    if (/^y/.test(v)) { details.heritage = true; add('Heritage', 'Yes', 'ok') }
    else if (/^n(o\b|$)/.test(v)) add('Heritage', 'No', 'ok')
    else if (v) add('Heritage', raw.heritage, 'unmatched', 'Left as No; tick it below if needed')
    else add('Heritage', '', 'empty')
  }

  if (raw.leader) {
    const g = matchPerson(raw.leader, ctx.guides || [])
    if (g) { details.tour_leader_id = g.id; add('Tour leader', raw.leader, 'ok', g.name === raw.leader ? null : g.name) }
    else add('Tour leader', raw.leader, 'unmatched', 'Not on the guide list')
  } else add('Tour leader', '', 'empty')

  if (ctx.gifts) {
    const note = raw.giftNote || ''
    const g = /^no(ne)?\b|no gift/i.test(note) ? { kind: 'NA', location: '' } : parseGift(raw.gift)
    if (g || note) {
      details.gift = { kind: g?.kind || 'NonMBV', location: g?.location || '', rooms: null, note }
      add('Gift in room', [raw.gift, note].filter(Boolean).join(' · '), 'ok',
        details.gift.kind === 'MBV' ? 'MBV gift' : details.gift.kind === 'NA' ? 'No gift' : 'Non-MBV gift')
    } else add('Gift in room', '', 'empty')
  }

  if (raw.notes) { details.notes = raw.notes.slice(0, 4000); add('Notes', raw.notes.length > 90 ? raw.notes.slice(0, 90) + '…' : raw.notes, 'ok') }
  else add('Notes', '', 'empty')

  return { fields, details, report, found: Object.keys(raw).length }
}

export async function readClientFile(file, ctx) {
  if (!/\.docx$/i.test(file.name)) throw new Error('Pick the Word (.docx) client file. In Google Docs: File → Download → Microsoft Word.')
  if (file.size > 15 * 1024 * 1024) throw new Error('That file is over 15 MB.')
  return readClientBuffer(await file.arrayBuffer(), ctx)
}

// Same, from .docx bytes (e.g. a Google Doc exported by the Drive function).
export function readClientBuffer(buf, ctx) {
  const res = parseClientText(docxToText(buf), ctx)
  if (!res.found) throw new Error("Couldn't find the client file fields (Client Name:, Travel Dates:, …) in that document.")
  if (res.report.every(r => r.status === 'empty')) throw new Error('That client file has no answers filled in yet.')
  return res
}
