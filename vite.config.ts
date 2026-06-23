import { defineConfig } from 'vite';

// The app is plain TS + Canvas — no framework plugin needed. index.html at the
// root is the entry; it pulls in /src/client/main.ts.
export default defineConfig({
  root: '.',
  server: { open: true },
  build: { target: 'es2022', outDir: 'dist' },
});
