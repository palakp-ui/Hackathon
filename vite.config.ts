import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Two pages: the full map (index.html) and the Georgia vs. Maryland maps (compare.html).
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        compare: resolve(__dirname, 'compare.html'),
      },
    },
  },
});
