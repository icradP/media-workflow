import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@media-workflow/core': resolve(__dirname, '../core/src'),
      '@media-workflow/codec': resolve(__dirname, '../codec/src'),
      '@media-workflow/nodes': resolve(__dirname, '../nodes/src'),
    },
  },
  worker: {
    format: 'es',
  },
  build: {
    target: 'esnext',
    outDir: 'dist',
  },
});
