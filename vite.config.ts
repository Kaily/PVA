import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Relative base so the built app can be served from any folder or sub-path.
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { port: 5173, strictPort: false },
  preview: { port: 4173 },
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 800 },
  test: { environment: 'node', include: ['tests/unit/**/*.test.ts'] },
});
