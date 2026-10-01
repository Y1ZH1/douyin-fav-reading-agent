import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
        proxyTimeout: 180000,
      },
      '/py': {
        target: 'http://127.0.0.1:8899',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/py/, ''),
      },
    },
  },
  build: {
    target: 'es2020',
    cssCodeSplit: true,
  },
})
