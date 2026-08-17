import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// GitHub Pages serves this repository from the branch root, so the built app
// lives at /study/asset-manager/app/ and must be committed.
export default defineConfig({
  base: '/study/asset-manager/app/',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: '../app',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
  },
})
