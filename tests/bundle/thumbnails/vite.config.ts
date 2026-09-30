import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

// Two pages out of one build, so both compositions are bundled by the same
// consumer-shaped bundler in the same run: whatever is shared between them
// lands in shared chunks, and the only asymmetry left is the `thumbnails`
// prop itself.
export default defineConfig({
  plugins: [react()],
  build: {
    manifest: true,
    rollupOptions: {
      input: {
        plain: fileURLToPath(new URL('./index.html', import.meta.url)),
        withThumbnails: fileURLToPath(
          new URL('./with-thumbnails.html', import.meta.url)
        )
      }
    }
  }
});
