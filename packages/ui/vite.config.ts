import { defineConfig } from 'vite';
import { resolve } from 'path';

// GitHub Pages 项目站需要子路径，例如 https://icradP.github.io/media-workflow/
const base = process.env.VITE_BASE_PATH ?? '/';

export default defineConfig({
  base,
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
