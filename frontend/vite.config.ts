import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// App da galeria servido em /app pelo Fastify (build em ../web/app).
export default defineConfig({
  plugins: [react()],
  base: '/app/',
  build: {
    outDir: '../web/app',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:3000',
    },
  },
});
