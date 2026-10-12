---
title: "@playdeck/react-18"
description: "Headless, composable React 18 media player primitives with capability-aware providers (React 18 build of @playdeck/react, produced entirely at build time from its unchanged source)."
---

`@playdeck/react` built for
React 18: the same headless, composable media-player primitives, the same
exports and the same types, built at build time from the same source — there
is no fork to drift out of sync. A JSX-runtime shim and `forwardRef` wrapping
of every exported component whose props accept a `ref` give it
`@playdeck/react`'s React 19 ref-as-prop and ref-cleanup behaviour on top of
React 18.

```sh
pnpm add @playdeck/react-18
```

`react` and `react-dom` are peer dependencies, at `>=18.3 <19`. There is no
`./browser` entry — that entry bundles its own React for a script-tag
consumer with no bundler, and a React 18 project already has one to point
at; a no-build consumer on React 18 should load React itself and use
`@playdeck/react`'s plain entry's `createElement`/`createRoot` re-exports
the way any other bundler-free React 18 page would.

It is released in lockstep with `@playdeck/react` — the same version
number, every time.

## Differences from React 19

- A consumer's own wrapper component that forwards a `ref` to a Playdeck
  primitive needs `forwardRef` under React 18, exactly as it would wrapping
  any other React 18 component. React 19 needs no such wrapper.
- `Player.Root`'s `warmUp` preconnect hints render as
  `<link rel="preconnect">` in place in the body, rather than hoisted into
  `<head>`. Browsers generally still act on a preconnect hint wherever it
  renders in the document.
- `PosterImage`'s `fetchPriority` prop still reaches the DOM as the
  `fetchpriority` attribute — React 18 has no built-in mapping for the
  camelCase prop, so this package renames it internally before the element
  reaches React. A consumer passing `fetchPriority` to `Player.PosterImage`
  sees the same attribute either package produces.
- Every export whose props accept a `ref` (`Player.Root`, `Player.SeekSlider`,
  and the rest) is a `forwardRef` object at runtime under this package,
  where `@playdeck/react` exports the plain function. `typeof Player.Root`
  and similar runtime introspection differ between the two packages; which
  components a consumer can attach a `ref` to does not.

## Moving to React 19

Install `@playdeck/react` in place of `@playdeck/react-18` and update the
import path. Nothing else changes.

## Docs

Everything else — usage, styling, exports, Media Session, provider setup —
is documented once, in `@playdeck/react`'s README, under its own React 18
section for the differences above.

## License

[MIT](https://github.com/pedrosousa13/playdeck/blob/main/packages/react-18/LICENSE).
