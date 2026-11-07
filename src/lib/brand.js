// Branding: logo processing, palette extraction and the CSS variables the app is themed with.

export const DEFAULT_COLORS = { primary: '#9c3d54', dark: '#7e2f43', light: '#c25a72', tint: '#f7ebee', line: '#ecd3da' }
const VARS = { primary: '--wine', dark: '--wine-dark', light: '--wine-light', tint: '--wine-tint', line: '--wine-line' }

// ---------- color math ----------
export function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255] }
export function rgbToHex(r, g, b) { return '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('') }
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2
  if (mx === mn) return [0, 0, l]
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn)
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h * 60, s, l]
}
function hslToHex(h, s, l) {
  const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l)
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return rgbToHex(f(0) * 255, f(8) * 255, f(4) * 255)
}
const hexToHsl = h => rgbToHsl(...hexToRgb(h))
function luminance(h) {
  const c = hexToRgb(h).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 })
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
export function contrast(a, b) { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }

// From one primary color, the full set the app uses. The primary is darkened if needed so
// white text on buttons stays readable (4.5:1).
export function deriveColors(primary) {
  let [h, s, l] = hexToHsl(primary)
  let p = primary
  while (contrast(p, '#ffffff') < 4.5 && l > 0.08) { l -= 0.02; p = hslToHex(h, s, l) }
  return {
    primary: p,
    dark: hslToHex(h, s, Math.max(0.08, l - 0.09)),
    light: hslToHex(h, Math.min(1, s * 0.9), Math.min(0.72, l + 0.16)),
    tint: hslToHex(h, Math.min(0.55, s * 0.6), 0.955),
    line: hslToHex(h, Math.min(0.45, s * 0.5), 0.88),
  }
}

// ---------- logo ----------
const loadImage = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("That file couldn't be read as an image.")); i.src = src })
const readFile = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(f) })

// Resize to fit 320px (keeps transparency) and return a PNG data URL plus the image for palette work.
export async function processLogo(file) {
  if (!/^image\/(png|jpeg|webp|svg\+xml|gif)$/.test(file.type)) throw new Error('Pick a PNG, JPG, WebP or SVG image.')
  if (file.size > 8 * 1024 * 1024) throw new Error('That image is over 8 MB. Pick a smaller one.')
  const img = await loadImage(await readFile(file))
  const w = img.naturalWidth || 320, h = img.naturalHeight || 320
  const scale = Math.min(1, 320 / Math.max(w, h))
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w * scale)); c.height = Math.max(1, Math.round(h * scale))
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
  let url = c.toDataURL('image/png')
  if (url.length > 380000) url = c.toDataURL('image/webp', 0.9)
  if (url.length > 380000) throw new Error('That logo is too detailed to store. Try a simpler or smaller version.')
  return { url, img }
}

// The logo's main colors, most prominent first. Ignores transparent, near-white,
// near-black and grey pixels; groups similar shades.
export function extractPalette(img, max = 6) {
  const c = document.createElement('canvas'), N = 64
  const scale = Math.min(1, N / Math.max(img.naturalWidth || N, img.naturalHeight || N))
  c.width = Math.max(1, Math.round((img.naturalWidth || N) * scale)); c.height = Math.max(1, Math.round((img.naturalHeight || N) * scale))
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(img, 0, 0, c.width, c.height)
  const px = ctx.getImageData(0, 0, c.width, c.height).data
  const buckets = new Map()
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 200) continue
    const [r, g, b] = [px[i], px[i + 1], px[i + 2]]
    const [, s, l] = rgbToHsl(r, g, b)
    if (l > 0.93 || l < 0.07 || s < 0.18) continue
    const key = (r >> 5) << 6 | (g >> 5) << 3 | (b >> 5)
    const e = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 }
    e.n++; e.r += r; e.g += g; e.b += b; buckets.set(key, e)
  }
  const total = [...buckets.values()].reduce((a, e) => a + e.n, 0)
  const ranked = [...buckets.values()].filter(e => e.n >= total * 0.03)   // drop edge blends
    .map(e => ({ hex: rgbToHex(e.r / e.n, e.g / e.n, e.b / e.n), n: e.n }))
    .map(e => { const [, s] = hexToHsl(e.hex); return { ...e, score: e.n * (0.5 + s) } })
    .sort((a, b) => b.score - a.score)
  const out = []
  for (const e of ranked) {
    if (out.every(o => colorDistance(o, e.hex) > 60)) out.push(e.hex)
    if (out.length >= max) break
  }
  return out
}
function colorDistance(a, b) { const x = hexToRgb(a), y = hexToRgb(b); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) }

// ---------- apply ----------
export function applyBranding(colors) {
  const root = document.documentElement
  const c = { ...DEFAULT_COLORS, ...(colors || {}) }
  for (const [k, v] of Object.entries(VARS)) root.style.setProperty(v, c[k])
}
