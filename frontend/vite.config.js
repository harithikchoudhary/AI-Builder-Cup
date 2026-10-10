import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/ask': 'http://127.0.0.1:8002',
      '/catalog-agent': 'http://127.0.0.1:8002',
      '/search': 'http://127.0.0.1:8002',
      '/health': 'http://127.0.0.1:8002',
      '/datasets': 'http://127.0.0.1:8002',
      '/visualize': 'http://127.0.0.1:8002',
    },
  },
})
