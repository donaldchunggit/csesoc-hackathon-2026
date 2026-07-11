import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Proxy /api to the FastAPI backend so the frontend can call the real API
// once it's up, and fall back to mock data otherwise (see src/api.js).
// Override the backend location with VITE_API_TARGET when it isn't on :8000.
const API_TARGET = process.env.VITE_API_TARGET || 'http://localhost:8000'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
