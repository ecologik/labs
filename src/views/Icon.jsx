// Sidebar icons, from the prototype.
const P = {
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  trips: 'M9 6V4h6v2M4 6h16v14H4zM4 11h16',
  mine: 'M9 6l2 2 4-4M9 12l2 2 4-4M9 18l2 2 4-4M4 6h1M4 12h1M4 18h1',
  team: 'M8 11a3 3 0 100-6 3 3 0 000 6zM2 20a6 6 0 0112 0M17 11a3 3 0 100-6M16 20a6 6 0 016-2',
  cal: 'M4 5h16v15H4zM4 9h16M8 3v4M16 3v4',
  heritage: 'M12 3l2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4L4.2 8.7l5.4-.8z',
  templates: 'M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h7',
  pin: 'M12 21s-7-6.2-7-11.5a7 7 0 0114 0C19 14.8 12 21 12 21zM12 12a2.5 2.5 0 100-5 2.5 2.5 0 000 5z',
  brand: 'M12 3a9 9 0 100 18c1.1 0 1.6-.8 1.6-1.6 0-.5-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1 0-.9.7-1.6 1.6-1.6h1.9A4.7 4.7 0 0021 11c0-4.4-4-8-9-8zM7.5 12.5h.01M9.5 8h.01M14.5 8h.01M16.5 12h.01',
}
export default function Icon({ name }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={P[name]} /></svg>
}

// Gift markers from the prototype: a gift box for an MBV gift, a wine bottle for a non-MBV gift.
export const GiftGlyph = ({ size = 28 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3.5" y="10.5" width="17" height="10" rx="1.4" fill="currentColor" fillOpacity="0.13" />
    <rect x="2.5" y="7.5" width="19" height="3.6" rx="1" fill="currentColor" fillOpacity="0.20" />
    <path d="M12 7.5V20.5" />
    <path d="M12 7.5C10.4 7.5 8 7.2 8 5.2c0-1.1 1-1.9 2-1.4C11.2 4.4 12 6 12 7.5z" fill="currentColor" fillOpacity="0.22" />
    <path d="M12 7.5C13.6 7.5 16 7.2 16 5.2c0-1.1-1-1.9-2-1.4C12.8 4.4 12 6 12 7.5z" fill="currentColor" fillOpacity="0.22" />
  </svg>
)
export const WineGlyph = ({ size = 28 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M10 2.5h4v4c0 1.2.9 2 1.5 3 .7 1.1 1 2.2 1 3.6V19a2.5 2.5 0 01-2.5 2.5h-4A2.5 2.5 0 017.5 19v-6.9c0-1.4.3-2.5 1-3.6.6-1 1.5-1.8 1.5-3z" />
    <path d="M7.7 11.5h8.6" strokeOpacity="0.5" />
    <rect x="10" y="1.5" width="4" height="2" rx="0.6" fill="currentColor" fillOpacity="0.25" />
  </svg>
)
