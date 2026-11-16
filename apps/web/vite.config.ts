import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: 5174,
    fs: {
      deny: [
        '.env',
        '.env.*',
        '*.{crt,pem,key}',
        '**/.git/**',
        '**/data/**',
        '**/backups/**',
        '**/*.sqlite*',
        '**/test-results/**',
      ],
    },
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:' + (process.env.CLASSFLOW_PORT ?? '4318'), changeOrigin: false },
    },
  },
  preview: { host: '127.0.0.1' },
});
