import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/admin/',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: '../public',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/admin/api': 'http://127.0.0.1:8787',
      '/admin/login': 'http://127.0.0.1:8787',
      '/admin/find': 'http://127.0.0.1:8787',
      '/admin/issue': 'http://127.0.0.1:8787',
      '/admin/grant': 'http://127.0.0.1:8787',
      '/admin/message': 'http://127.0.0.1:8787',
      '/admin/promo': 'http://127.0.0.1:8787',
      '/admin/promo-revoke': 'http://127.0.0.1:8787',
      '/admin/unbind': 'http://127.0.0.1:8787',
      '/admin/password': 'http://127.0.0.1:8787',
      '/admin/logout': 'http://127.0.0.1:8787',
      '/admin/session-revoke': 'http://127.0.0.1:8787',
      '/admin/settings': 'http://127.0.0.1:8787',
      '/admin/finance.csv': 'http://127.0.0.1:8787',
    },
  },
});
