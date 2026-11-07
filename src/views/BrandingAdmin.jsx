import { useEffect, useRef, useState } from 'react'
import { useSession } from '../lib/session'
import { supabase } from '../lib/supabase'
import { DEFAULT_COLORS, applyBranding, contrast, deriveColors, extractPalette, processLogo } from '../lib/brand'
import { BODY_FONTS, DEFAULT_FONTS, HEADING_FONTS, applyFonts } from '../lib/fonts'

const LABELS = { primary: 'Main color', dark: 'Darker (hover, active text)', light: 'Lighter (progress bars)', tint: 'Soft background', line: 'Soft border' }

// A list of fonts, each shown in its own face.
function FontPicker({ title, list, value, sample, heading, onPick }) {
  return (
    <div className="fld"><span>{title}</span>
      <div className="font-list" role="radiogroup" aria-label={title}>
        {list.map(f => (
          <button type="button" key={f.key} role="radio" aria-checked={value === f.key} className={'font-opt' + (value === f.key ? ' on' : '')} onClick={() => onPick(f.key)}>
            <span className="font-name" style={{ fontFamily: f.stack, fontWeight: heading ? f.headWeight : 400 }}>{f.label}</span>
            <span className="font-sample" style={{ fontFamily: f.stack, fontWeight: heading ? f.headWeight : 400 }}>{sample}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

export default function BrandingAdmin() {
  const { tenant, refreshTenant } = useSession()
  const saved = tenant.settings?.branding || {}
  const savedColors = { ...DEFAULT_COLORS, ...(saved.colors || {}) }
  const savedFonts = { ...DEFAULT_FONTS, ...(saved.fonts || {}) }
  const [name, setName] = useState(tenant.name)
  const [logo, setLogo] = useState(saved.logo || null)
  const [logoOnly, setLogoOnly] = useState(Boolean(saved.logo_only))
  const [colors, setColors] = useState(savedColors)
  const [fonts, setFonts] = useState(savedFonts)
  const [palette, setPalette] = useState([])
  const [fine, setFine] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [err, setErr] = useState(null)
  const fileRef = useRef(null)
  const savedRef = useRef({ colors: savedColors, fonts: savedFonts })
  useEffect(() => { savedRef.current = { colors: savedColors, fonts: savedFonts } })

  // Live preview while editing; put the saved colors back when leaving the page.
  useEffect(() => { applyBranding(colors) }, [colors])
  useEffect(() => { applyFonts(fonts) }, [fonts])
  useEffect(() => () => { applyBranding(savedRef.current.colors); applyFonts(savedRef.current.fonts) }, [])

  // Palette from the logo already on file.
  useEffect(() => {
    if (!saved.logo) return
    const i = new Image(); i.onload = () => setPalette(extractPalette(i)); i.src = saved.logo
  }, [saved.logo])

  const pick = async e => {
    const f = e.target.files?.[0]; e.target.value = ''
    if (!f) return
    setErr(null); setMsg(null)
    try {
      const { url, img } = await processLogo(f)
      const pal = extractPalette(img)
      setLogo(url); setPalette(pal)
      if (pal[0]) setColors(deriveColors(pal[0]))
      setMsg(pal.length ? 'Colors suggested from your logo. Click a swatch to try another, then Save.' : "Couldn't find strong colors in that logo; pick one below.")
    } catch (x) { setErr(x.message) }
  }

  const save = async e => {
    e.preventDefault()
    setBusy(true); setErr(null); setMsg(null)
    const { error } = await supabase.rpc('admin_set_branding', {
      p_tenant: tenant.id, p_name: name, p_branding: { ...(logo ? { logo, logo_only: logoOnly } : {}), colors, fonts },
    })
    setBusy(false)
    if (error) { setErr(error.message); return }
    savedRef.current = { colors, fonts }
    refreshTenant()
    setMsg('Saved. Everyone sees the new branding the next time their page loads.')
  }

  const dirty = name.trim() !== tenant.name || logo !== (saved.logo || null) || (Boolean(logo) && logoOnly !== Boolean(saved.logo_only)) || Object.keys(colors).some(k => colors[k] !== savedColors[k]) || fonts.heading !== savedFonts.heading || fonts.body !== savedFonts.body
  const lowContrast = contrast(colors.primary, '#ffffff') < 4.5

  return (
    <form className="view brand-admin" onSubmit={save}>
      <div className="card intro">
        <b>Branding</b> sets the organization name, logo, colors and fonts everyone on your team sees. Upload the logo and the app suggests colors from it.
      </div>

      <div className="card brand-grid">
        <div className="brand-col">
          <label className="fld">Organization name<input required maxLength={120} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. My Bella Vita Travel" /></label>

          <div className="fld"><span>Logo</span>
            <div className="logo-box">
              {logo ? <img src={logo} alt={`${name} logo`} /> : <span className="muted small">No logo yet</span>}
            </div>
            <div className="row-btns">
              <button type="button" className="btn ghost" onClick={() => fileRef.current?.click()}>{logo ? 'Replace logo' : 'Upload logo'}</button>
              {logo && <button type="button" className="linkbtn subtle" onClick={() => setLogo(null)}>Remove</button>}
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif" hidden onChange={pick} />
            </div>
            <span className="muted small">PNG with a transparent background works best. It's resized to fit 320 px.</span>
            {logo && <label className="check-row"><input type="checkbox" checked={logoOnly} onChange={e => setLogoOnly(e.target.checked)} />
              Show only the logo in the sidebar (full width, no name)</label>}
          </div>
        </div>

        <div className="brand-col">
          <div className="fld"><span>Colors</span>
            {palette.length > 0 && <>
              <div className="muted small">From your logo: click one to use it as the main color</div>
              <div className="swatches">
                {palette.map(h => (
                  <button type="button" key={h} className={'swatch' + (colors.primary === deriveColors(h).primary ? ' on' : '')} style={{ background: h }}
                    title={h} aria-label={`Use ${h}`} onClick={() => setColors(deriveColors(h))} />
                ))}
              </div>
            </>}
            <div className="main-color">
              <input type="color" value={colors.primary} onChange={e => setColors(fine ? { ...colors, primary: e.target.value } : deriveColors(e.target.value))} aria-label="Main color" />
              <span><b>{colors.primary}</b> main color</span>
              <button type="button" className="linkbtn subtle" onClick={() => setColors(DEFAULT_COLORS)}>Reset to default</button>
            </div>
            {lowContrast && <p className="warn small">White text is hard to read on this color. Pick a darker one, or let the app adjust it by clicking a swatch.</p>}
            <button type="button" className="linkbtn" onClick={() => setFine(v => !v)}>{fine ? 'Hide fine-tuning' : 'Fine-tune each shade'}</button>
            {fine && (
              <div className="fine">
                {Object.keys(LABELS).map(k => (
                  <label key={k} className="fine-row"><input type="color" value={colors[k]} onChange={e => setColors({ ...colors, [k]: e.target.value })} />{LABELS[k]} <code>{colors[k]}</code></label>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-h"><h2>Fonts</h2><span className="muted small">Bundled with the app. Headings are titles and the organization name; body is everything else.</span></div>
        <div className="brand-grid">
          <FontPicker title="Headings" list={HEADING_FONTS} value={fonts.heading} sample="Calabria Food & Wine" heading onPick={k => setFonts(v => ({ ...v, heading: k }))} />
          <FontPicker title="Body text" list={BODY_FONTS} value={fonts.body} sample="Rooming list collected · due in 3 days" onPick={k => setFonts(v => ({ ...v, body: k }))} />
        </div>
      </div>

      <div className="card">
        <div className="card-h"><h2>Preview</h2><span className="muted small">The whole app is showing these colors and fonts while you edit.</span></div>
        <div className="preview">
          <div className="pv-side">
            {logo && logoOnly
              ? <div className="brand logo-only"><img className="brand-logo" src={logo} alt="" /></div>
              : <div className="brand">{logo ? <img className="brand-logo" src={logo} alt="" /> : <div className="brand-mark">{(name || '?')[0]}</div>}
                <div><div className="brand-name">{name || 'Organization'}</div><div className="brand-sub">EcoLogik Labs</div></div></div>}
            <div className="nav active">Trips <span className="badge">14</span></div>
            <div className="nav">My Tasks</div>
          </div>
          <div className="pv-main">
            <h3 className="pv-title">Calabria Food &amp; Wine</h3>
            <p className="pv-body">Rooming list collected. Final documents go to the client 20 days before departure.</p>
            <button type="button" className="btn">+ New Trip</button>
            <span className="pchip on">Calabria</span>
            <div className="dprog"><div className="ptrack"><div className="pfill" style={{ width: '60%' }} /></div><span>3/5 done</span></div>
          </div>
        </div>
      </div>

      {err && <p className="err">{err}</p>}
      {msg && <p className="ok-msg">{msg}</p>}
      <div className="row-btns">
        <button className="btn" disabled={busy || !dirty || !name.trim()}>{busy ? 'Saving…' : 'Save branding'}</button>
        {dirty && <button type="button" className="btn ghost" onClick={() => { setName(tenant.name); setLogo(saved.logo || null); setLogoOnly(Boolean(saved.logo_only)); setColors(savedColors); setFonts(savedFonts); setMsg(null) }}>Discard changes</button>}
      </div>
    </form>
  )
}
