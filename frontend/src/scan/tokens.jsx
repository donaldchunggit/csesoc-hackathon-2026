// Shared design tokens for the consumer scan mode.
//
// These MIRROR the `T` palette and helpers defined in App.jsx (which in turn
// mirror theme.css) so the scan pages reuse the exact same visual system — warm
// paper + forest green — without importing from App.jsx or introducing a new one.
import React from 'react'

export const T = {
  page: '#F4F1EA', card: '#FBFAF6', cardAlt: '#F2EEE3',
  ink: '#23211C', ink2: '#4A463C', ink3: '#6E6A5F', muted: '#8A857A', faint: '#A39C8C',
  line: '#E3DCCD', line2: '#EDE7DA',
  accent: '#1E3D2B', accentSoft: 'rgba(30,61,43,0.10)',
  good: '#5B7A4E', warn: '#A87A3C', bad: '#B0576E',
}

// The 4-band verdict colours (Yuka-style traffic-light, tuned to the warm palette).
// Used identically for both the repairability and carbon grades.
export const BAND = {
  Excellent: { fg: '#2F6B43', bg: 'rgba(47,107,67,0.12)', ring: '#2F6B43', label: 'Excellent' },
  Good: { fg: '#6E8F49', bg: 'rgba(110,143,73,0.14)', ring: '#7C9A4E', label: 'Good' },
  Poor: { fg: '#B07636', bg: 'rgba(176,118,54,0.14)', ring: '#C07A3A', label: 'Poor' },
  Bad: { fg: '#A8425C', bg: 'rgba(176,87,110,0.13)', ring: '#B0576E', label: 'Bad' },
  // Fallback for a missing/unknown score.
  Unknown: { fg: '#8A857A', bg: '#F2EEE3', ring: '#C9C1B0', label: 'No data' },
}

export const bandStyle = (band) => BAND[band] || BAND.Unknown

// Tiny inline icon — same API as App.jsx's Icon.
export const Icon = ({ d, size = 24, stroke = 'currentColor', sw = 2, fill = 'none', ...p }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={stroke}
    strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" {...p}>
    {(Array.isArray(d) ? d : [d]).map((path, i) => <path key={i} d={path} />)}
  </svg>
)

// A handful of icon path sets reused across the scan components.
export const ICONS = {
  barcode: ['M3 5v14', 'M7 5v14', 'M11 5v14', 'M15 5v14', 'M19 5v14'],
  camera: ['M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z', 'M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'],
  check: ['M20 6 9 17l-5-5'],
  spark: ['M12 3v3', 'M12 18v3', 'M5.6 5.6l2.1 2.1', 'M16.3 16.3l2.1 2.1', 'M3 12h3', 'M18 12h3', 'M5.6 18.4l2.1-2.1', 'M16.3 7.7l2.1-2.1'],
  copy: ['M9 9h10a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2z', 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1'],
  mail: ['M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z', 'm22 6-10 7L2 6'],
  arrowUpRight: ['M7 17 17 7', 'M7 7h10v10'],
  megaphone: ['M3 11v2a1 1 0 0 0 1 1h2l4 4V6L6 10H4a1 1 0 0 0-1 1z', 'M15 8a5 5 0 0 1 0 8', 'M18 5a9 9 0 0 1 0 14'],
  upload: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M17 8l-5-5-5 5', 'M12 3v12'],
}

// Shared button styles (mirror App.jsx).
export const btnSolid = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, background: T.ink, color: T.page, border: 'none', fontSize: 13, fontWeight: 600, padding: '11px 18px', borderRadius: 10, cursor: 'pointer', fontFamily: 'Nunito, sans-serif' }
export const btnGhost = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, background: T.card, color: T.ink, border: `1px solid ${T.line}`, fontSize: 13, fontWeight: 600, padding: '11px 17px', borderRadius: 10, cursor: 'pointer', fontFamily: 'Nunito, sans-serif' }
export const btnAccent = { ...btnSolid, background: T.accent }
