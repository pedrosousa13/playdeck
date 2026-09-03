import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Both fixture pages, named explicitly. Vite builds the project root's
// `index.html` and nothing else by default -- it does not discover sibling HTML
// files -- so `docked.html` is emitted only because it is listed here. Verified
// against the vite this fixture pins (8.1.5): with this key absent, `dist`
// carries `index.html` alone and the smoke test's second page 404s.
//
// `import.meta.dirname`, not `__dirname` -- this file's own `package.json`
// carries `"type": "module"`.
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, 'index.html'),
        docked: resolve(import.meta.dirname, 'docked.html')
      }
    }
  }
});
