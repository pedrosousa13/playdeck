import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

// Three pages out of one build, one per `loading` strategy, so whatever is
// shared between them lands in shared chunks and the only asymmetry left is
// the `loading` prop itself -- the same reason tests/bundle/thumbnails bundles
// its two pages from one config rather than three separate builds.
export default defineConfig({
  plugins: [react()],
  build: {
    manifest: true,
    rollupOptions: {
      input: {
        eager: fileURLToPath(new URL('./eager.html', import.meta.url)),
        viewport: fileURLToPath(new URL('./viewport.html', import.meta.url)),
        interaction: fileURLToPath(
          new URL('./interaction.html', import.meta.url)
        )
      }
    }
  }
});
