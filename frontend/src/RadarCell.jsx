// Radar comparing the original material vs the top suggestion across the four
// normalised axes (higher = better on every axis).
//
// Split into its own module so recharts (the app's heaviest dependency) is a
// lazy chunk — it only loads when a user expands a swap's detail, keeping the
// landing, scan and library views light. App.jsx React.lazy()s this.
import React from 'react'
import {
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
  ResponsiveContainer, Legend, Tooltip,
} from 'recharts'

// The handful of palette values this chart needs (mirrors theme.css / App.jsx T).
const C = { line: '#E3DCCD', ink3: '#6E6A5F', muted: '#8A857A', accent: '#1E3D2B', card: '#FBFAF6' }

export default function RadarCell({ line }) {
  return (
    <div style={{ width: '100%', height: 250, minWidth: 240 }}>
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={line.radar} outerRadius="70%">
          <PolarGrid stroke={C.line} />
          <PolarAngleAxis dataKey="axis" tick={{ fill: C.ink3, fontSize: 11 }} />
          <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
          <Radar name={line.from} dataKey="original" stroke={C.muted} fill={C.muted} fillOpacity={0.16} strokeWidth={1.5} />
          {line.swapped && <Radar name={line.to} dataKey="suggestion" stroke={C.accent} fill={C.accent} fillOpacity={0.24} strokeWidth={1.6} />}
          <Legend wrapperStyle={{ fontSize: 11, fontFamily: "'Geist Mono', monospace" }} />
          <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8, border: `1px solid ${C.line}`, background: C.card }} />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  )
}
