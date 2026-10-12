import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

// Runs `../react/test`'s own, completely unmodified suite against this
// package's entry instead of `../react/src/index.tsx` directly, with React
// 18.3.1 (this package's own devDependency, not the workspace's 19.3.0)
// resolved for every `react`/`react-dom`/`@testing-library/react` import
// anywhere in the run -- including from inside the test files themselves,
// which Node's ordinary resolution would otherwise answer from
// `packages/react/node_modules` upward, finding the workspace's 19.3.0
// (and @testing-library/react's own copy peer-resolved against it) before
// either ever reached this package's own, differently-pinned copies.

// This package's own `src/` -- every file in it (`entry.tsx`,
// `jsx-runtime-18.ts`, `react-shim-18.ts`, `shim-shared.ts`) must reach the
// real, pinned-18.3.1 `react`/`react/jsx-runtime`/`react/jsx-dev-runtime`
// directly, never the shims below (which live in this same directory).
const OWN_SRC_DIR = fileURLToPath(new URL('./src/', import.meta.url));
const JSX_SHIM_PATH = fileURLToPath(
  new URL('./src/jsx-runtime-18.ts', import.meta.url)
);
const REACT_SHIM_PATH = fileURLToPath(
  new URL('./src/react-shim-18.ts', import.meta.url)
);
// Only `../react/src`'s OWN compiled JSX/`createElement` calls may be
// redirected to a shim -- exactly what the shipped package's build does,
// since both shims are private to this package's own bundle. Without this
// guard, every test FILE's own JSX (`packages/react/test/**`) would be
// redirected too, since the test run's `root` sits at `packages/react/test`
// and nothing else would distinguish an import coming from there. That
// would quietly make a fixture like `index.test.tsx`'s `LegacyRoot` -- a
// consumer-authored plain function component that forwards `ref` to
// `Player.Root`, the one failure shape the design doc predicts and asks to
// be classified rather than fixed -- pass here while still failing for a
// real consumer, whose own app code compiles through their own, unshimmed
// `react/jsx-runtime`.
const REACT_SRC_DIR = fileURLToPath(new URL('../react/src/', import.meta.url));
// Any real file inside this package, passed as the `importer` to
// `this.resolve` below so Node's own upward node_modules walk starts here
// -- inside packages/react-18, where this package's own devDependencies
// react, react-dom (18.3.1) and @testing-library/react (16.3.3, peer-paired
// with that same 18.3.1) sit -- rather than at the real importer's location
// (anywhere under packages/react/test), which would otherwise answer from
// the workspace's hoisted 19.3.0-paired copies first.
const RESOLVE_FROM_HERE = fileURLToPath(
  new URL('./package.json', import.meta.url)
);
const ENTRY_PATH = fileURLToPath(new URL('./src/entry.tsx', import.meta.url));

const ALIASED_JSX_SPECIFIERS = new Set([
  'react/jsx-runtime',
  'react/jsx-dev-runtime'
]);

const isOtherPinnedSpecifier = (source: string): boolean =>
  source === 'react-dom' ||
  source.startsWith('react-dom/') ||
  source === '@testing-library/react' ||
  source.startsWith('@testing-library/react/');

// One plugin, not several, and deliberately so: `this.resolve()` re-runs the
// WHOLE plugin pipeline (minus the calling plugin itself, under
// `skipSelf`), so splitting the jsx-runtime redirect, the `react`
// (`createElement`) redirect and the plain version pin across separate
// plugins would make each one's `this.resolve()` call re-enter the OTHERS'
// `resolveId` for the exact same specifier -- the jsx shim's own self-import
// did exactly this across two plugins and recursed until the call stack
// overflowed (caught empirically: `jsxDEV` calling itself). Keeping every
// concern in one `resolveId` means `skipSelf` excludes the only plugin that
// could ever re-redirect any of them.
const react18ShimsAndPin = (): Plugin => ({
  name: 'playdeck-react-18-shims-and-pin',
  enforce: 'pre',
  resolveId(source, importer) {
    const fromOwnSrc = importer?.startsWith(OWN_SRC_DIR) ?? false;
    const fromReactSrc = importer?.startsWith(REACT_SRC_DIR) ?? false;

    if (ALIASED_JSX_SPECIFIERS.has(source)) {
      if (fromOwnSrc) {
        return this.resolve(source, RESOLVE_FROM_HERE, { skipSelf: true });
      }
      if (fromReactSrc) return JSX_SHIM_PATH;
      // Every other importer (test files) still needs the real runtime
      // pinned to this package's own 18.3.1, same as a bare `react` import
      // below -- otherwise a test file's own JSX would compile against
      // whichever `react/jsx-runtime` Node's ordinary resolution finds
      // first (the workspace's hoisted 19.3.0), creating React-19-shaped
      // elements that React 18's reconciler, rendering everything
      // underneath, does not recognise ("Objects are not valid as a React
      // child" -- caught empirically, not reasoned out in advance).
      return this.resolve(source, RESOLVE_FROM_HERE, { skipSelf: true });
    }

    if (source === 'react') {
      if (fromOwnSrc) {
        return this.resolve(source, RESOLVE_FROM_HERE, { skipSelf: true });
      }
      if (fromReactSrc) return REACT_SHIM_PATH;
      return this.resolve(source, RESOLVE_FROM_HERE, { skipSelf: true });
    }

    if (isOtherPinnedSpecifier(source)) {
      return this.resolve(source, RESOLVE_FROM_HERE, { skipSelf: true });
    }

    return null;
  }
});

export default defineConfig({
  plugins: [react18ShimsAndPin()],
  resolve: {
    alias: [
      // The one rewrite every test file needs: all thirty-one files import
      // the package source as `'../src/index'` (relative to
      // `packages/react/test`), which this sends to this package's own
      // entry instead -- the forwardRef-wrapped, shim-built equivalent --
      // so every test exercises the same public surface a real React 18
      // consumer would import. Anchored (`^...$`) so it matches only that
      // exact bare specifier, never a longer path that happens to start the
      // same way.
      {
        find: /^\.\.\/src\/index$/,
        replacement: ENTRY_PATH
      },
      // `icons.test.tsx` imports a handful of icons directly from
      // `'../src/icons'` and asserts each is the SAME object `Player`
      // re-exports (`expect(Player.SettingsIcon).toBe(SettingsIcon)`).
      // `entry.tsx` wraps every ref-accepting export, icons included, in its
      // own `forwardRef` object -- a different object from the one
      // `'../src/icons'` would otherwise answer with -- so that assertion
      // only holds here if both imports resolve to the one module. Redirecting
      // this specifier to the same entry rather than excluding the test or
      // leaving icons unwrapped keeps every exported icon able to take a
      // `ref` under React 18 exactly like every other wrapped export.
      {
        find: /^\.\.\/src\/icons$/,
        replacement: ENTRY_PATH
      }
    ]
  },
  test: {
    root: fileURLToPath(new URL('../react/test/', import.meta.url)),
    environment: 'happy-dom',
    css: { include: [/theme\.css/] },
    include: ['**/*.test.{ts,tsx}']
  }
});
