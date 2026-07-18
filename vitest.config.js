import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.js'],
    include: ['tests/**/*.test.{js,jsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{js,jsx}'],
      exclude: ['src/main/index.js'], // Electron entry has side effects
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src/renderer'),
      // Test-only: qrcode.react is a real prod dep (in package.json), but the
      // renderer tests only need the import graph to resolve, not actual QR
      // rendering. Aliasing to a stub stops a missing/unresolved dep from
      // cascading into unrelated test failures. Does not affect the app build.
      'qrcode.react': path.resolve(__dirname, 'tests/stubs/qrcode-react.jsx'),
    },
  },
});
