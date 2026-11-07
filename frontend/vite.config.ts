import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  server: { port: 5173, strictPort: true }, // backend CORS allows exactly http://localhost:5173
  test: {
    environment: 'jsdom',
    // Same origin as the API, so jsdom's XHR does not apply CORS rules to msw-mocked responses.
    environmentOptions: { jsdom: { url: 'http://localhost:8000/' } },
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
