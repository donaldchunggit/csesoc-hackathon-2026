import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

// Proxy /api to the FastAPI backend so the frontend can call the real API
// once it's up, and fall back to mock data otherwise (see src/api.js).
// Override the backend location with VITE_API_TARGET when it isn't on :8000.
const API_TARGET = process.env.VITE_API_TARGET || 'http://localhost:8000'

// `npm run dev:mobile` sets VITE_HTTPS=1 and --host, so the dev server is served
// over https on your LAN. Mobile browsers block the camera (getUserMedia) on a
// plain-http LAN address, so https is required to test the scanner on a phone.
const HTTPS = !!process.env.VITE_HTTPS

export default defineConfig({
  plugins: [react(), ...(HTTPS ? [basicSsl()] : [])],
  server: {
    port: 5173,
    // Allow access through a tunnel host (e.g. *.trycloudflare.com) — Vite 5
    // otherwise blocks requests with an unknown Host header. Dev-only.
    allowedHosts: true,
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
