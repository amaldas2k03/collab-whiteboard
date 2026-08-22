import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// The client and server share the `@shared/*` source folder (protocol + merge).
// We alias it here and allow Vite to serve files from the parent dir.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../shared'),
    },
  },
  server: {
    port: 3000,
    strictPort: true,
    host: true,
    fs: {
      // permit importing ../shared (outside the client root)
      allow: [path.resolve(__dirname, '..')],
    },
  },
});
