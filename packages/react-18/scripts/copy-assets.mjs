// Runs after `vite build` as the last build-time step. It ships two things
// this package never asks `tsc` to produce for itself:
//
// - The `.d.ts` files: @playdeck/react's own declaration output is already
//   the correct public type surface for this package too, since
//   entry.tsx (generated) keeps every export name and prop shape identical
//   to @playdeck/react's (minus `./browser`, which this package does not
//   publish) -- a `forwardRef`-wrapped component and the plain function it
//   wraps are both valid JSX element types for the same props, so nothing
//   about wrapping changes what a consumer's type-checker should accept.
//   Copying sidesteps a real cross-package `tsc -b` emission problem: this
//   package's own `src` only contains `entry.tsx`/`jsx-runtime-18.ts`, and
//   `entry.tsx` imports `../../react/src/index.tsx`, which sits outside any
//   `rootDir` this package could declare for itself -- `tsc -b` emitting
//   declarations from a program that reaches outside `rootDir` fails with
//   TS6059. `.d.ts.map` files are deliberately not copied: their relative
//   paths point back at @playdeck/react's own `src`, which would resolve to
//   the wrong file once sitting beside a different package's `dist`.
//
// - `theme.css` and `docked.css`: @playdeck/react's own copies, unchanged --
//   nothing about either file is React-version-specific. The copies this
//   writes are gitignored build output, not committed source: committing
//   them would let a copy go stale whenever @playdeck/react's CSS changes.
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import console from 'node:console';

const reactDist = fileURLToPath(new URL('../../react/dist/', import.meta.url));
const ownDist = fileURLToPath(new URL('../dist/', import.meta.url));
mkdirSync(ownDist, { recursive: true });

const dtsFiles = readdirSync(reactDist).filter(
  (name) => name.endsWith('.d.ts') && name !== 'browser.d.ts'
);
for (const name of dtsFiles) {
  copyFileSync(
    new URL(name, `file://${reactDist}`),
    new URL(name, `file://${ownDist}`)
  );
}

const reactRoot = fileURLToPath(new URL('../../react/', import.meta.url));
const ownRoot = fileURLToPath(new URL('../', import.meta.url));
for (const name of ['theme.css', 'docked.css']) {
  copyFileSync(
    new URL(name, `file://${reactRoot}`),
    new URL(name, `file://${ownRoot}`)
  );
}

console.log(
  `copy-assets: copied ${dtsFiles.length} .d.ts file(s) and 2 .css file(s) from @playdeck/react.`
);
