// The no-build entry: a consumer with a plain HTML page and a
// `<script type="module">` tag, no bundler and no package manager. React 19
// ships no UMD and no ESM -- `react`'s own `exports` carries only a CommonJS
// `default` condition -- so there is no browser module an import map could
// point at. This is therefore the one entry in the package that bundles React
// and ReactDOM rather than leaving them external, and it re-exports just
// enough of each for a consumer with nothing but a script tag to render a
// tree with no JSX: `createElement` to build one, `createRoot` to mount it.
// Everything else re-exported here is this package's ordinary public surface,
// unchanged -- see vite.browser.config.ts for how the provider adapters stay
// lazy in this build despite React no longer being external.
export * from './index.js';
export { createElement, Fragment } from 'react';
export { createRoot } from 'react-dom/client';
