// Fonts an admin can pick on the Branding page. Bundled with the app (no calls to Google's
// servers); the browser only downloads a font file when a font is actually used.
// Add a font: npm i the @fontsource package, import its CSS below, add a row to FONTS.
import '@fontsource-variable/inter/wght.css'
import '@fontsource-variable/source-sans-3/wght.css'
import '@fontsource-variable/nunito/wght.css'
import '@fontsource/lato/latin-400.css'
import '@fontsource/lato/latin-ext-400.css'
import '@fontsource/lato/latin-700.css'
import '@fontsource/lato/latin-ext-700.css'
import '@fontsource-variable/open-sans/wght.css'
import '@fontsource-variable/roboto/wght.css'
import '@fontsource-variable/work-sans/wght.css'
import '@fontsource-variable/dm-sans/wght.css'
import '@fontsource-variable/figtree/wght.css'
import '@fontsource-variable/manrope/wght.css'
import '@fontsource-variable/mulish/wght.css'
import '@fontsource-variable/playfair-display/wght.css'
import '@fontsource-variable/lora/wght.css'
import '@fontsource-variable/cormorant-garamond/wght.css'
import '@fontsource/libre-baskerville/latin-400.css'
import '@fontsource/libre-baskerville/latin-ext-400.css'
import '@fontsource/libre-baskerville/latin-700.css'
import '@fontsource/libre-baskerville/latin-ext-700.css'
import '@fontsource/dm-serif-display/latin-400.css'
import '@fontsource/dm-serif-display/latin-ext-400.css'
import '@fontsource-variable/fraunces/wght.css'
import '@fontsource-variable/eb-garamond/wght.css'
import '@fontsource-variable/montserrat/wght.css'
import '@fontsource-variable/raleway/wght.css'
import '@fontsource-variable/josefin-sans/wght.css'
import '@fontsource/poppins/latin-400.css'
import '@fontsource/poppins/latin-ext-400.css'
import '@fontsource/poppins/latin-500.css'
import '@fontsource/poppins/latin-ext-500.css'
import '@fontsource/poppins/latin-600.css'
import '@fontsource/poppins/latin-ext-600.css'
import '@fontsource/poppins/latin-700.css'
import '@fontsource/poppins/latin-ext-700.css'

const SYS = 'system-ui,-apple-system,"Segoe UI",sans-serif'
const SERIF = 'Georgia,"Times New Roman",serif'
const f = (key, label, family, fallback, opts = {}) => ({ key, label, stack: `'${family}',${fallback}`, headWeight: 700, ...opts })

export const SYSTEM_FONT = { key: 'system', label: 'System default', stack: SYS, headWeight: 700 }

// Headings: titles, page and card headers, the organization name.
export const HEADING_FONTS = [
  SYSTEM_FONT,
  f('playfair-display', 'Playfair Display', 'Playfair Display Variable', SERIF),
  f('lora', 'Lora', 'Lora Variable', SERIF),
  f('cormorant-garamond', 'Cormorant Garamond', 'Cormorant Garamond Variable', SERIF),
  f('eb-garamond', 'EB Garamond', 'EB Garamond Variable', SERIF, { headWeight: 600 }),
  f('libre-baskerville', 'Libre Baskerville', 'Libre Baskerville', SERIF),
  f('dm-serif-display', 'DM Serif Display', 'DM Serif Display', SERIF, { headWeight: 400 }),
  f('fraunces', 'Fraunces', 'Fraunces Variable', SERIF, { headWeight: 650 }),
  f('montserrat', 'Montserrat', 'Montserrat Variable', SYS),
  f('raleway', 'Raleway', 'Raleway Variable', SYS),
  f('josefin-sans', 'Josefin Sans', 'Josefin Sans Variable', SYS),
  f('poppins', 'Poppins', 'Poppins', SYS, { headWeight: 600 }),
]

// Body: everything else (task lists, forms, buttons). Only easy-to-read faces.
export const BODY_FONTS = [
  SYSTEM_FONT,
  f('inter', 'Inter', 'Inter Variable', SYS),
  f('source-sans-3', 'Source Sans 3', 'Source Sans 3 Variable', SYS),
  f('nunito', 'Nunito', 'Nunito Variable', SYS),
  f('lato', 'Lato', 'Lato', SYS),
  f('open-sans', 'Open Sans', 'Open Sans Variable', SYS),
  f('roboto', 'Roboto', 'Roboto Variable', SYS),
  f('work-sans', 'Work Sans', 'Work Sans Variable', SYS),
  f('dm-sans', 'DM Sans', 'DM Sans Variable', SYS),
  f('figtree', 'Figtree', 'Figtree Variable', SYS),
  f('manrope', 'Manrope', 'Manrope Variable', SYS),
  f('mulish', 'Mulish', 'Mulish Variable', SYS),
]

export const DEFAULT_FONTS = { heading: 'system', body: 'system' }
const find = (list, key) => list.find(x => x.key === key) || SYSTEM_FONT

export function applyFonts(fonts) {
  const root = document.documentElement.style
  const fo = { ...DEFAULT_FONTS, ...(fonts || {}) }
  const h = find(HEADING_FONTS, fo.heading), b = find(BODY_FONTS, fo.body)
  root.setProperty('--font-body', b.stack)
  root.setProperty('--font-head', h.key === 'system' ? b.stack : h.stack)   // "System default" heading = same as body
  root.setProperty('--font-head-weight', String(h.headWeight))
}
