import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Platform backend (publisher management, auth, stats)
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      // CAPTCHA microservice (generate + verify puzzles)
      '/generate-captcha': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/verify-captcha': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/pow-challenge': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/video-captcha-stream': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/video-captcha-slider': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      // Widget JS served from CAPTCHA service
      '/static': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  define: {
    'process.env': {},
    global: 'globalThis',
  },
})
