---
'@playdeck/react': minor
---

`@playdeck/react`'s entry now ships a `'use client'` directive, so a React
Server Component can import the primitives and render them without a wrapper of
the consumer's own to hold the boundary (#500).

**What a consumer got before.** Measured, not predicted: an App Router page
(Next.js 16.2.11, Turbopack) that imports `Player.Root` from a server component
fails to build, seven times over — once per React API the built entry reaches
for:

```
Error: Turbopack build failed with 7 errors:
./packages/react/dist/index.js:2:10
You're importing a module that depends on `createContext` into a React Server
Component module. This API is only available in Client Components. To fix, mark
the file (or its parent) with the `"use client"` directive.
```

The remaining six name `useEffect`, `useImperativeHandle`, `useLayoutEffect`,
`useRef`, `useState` and `useSyncExternalStore`. The report is accurate and its
instruction is unreachable: the file it asks to be marked is the package's own
built entry, which for an installed consumer sits under `node_modules`. Their
actual fix is a component of their own that carries the directive and
re-exports what they needed — a supported constraint met at the worst moment,
which is the shape #458 was filed and fixed for on the CommonJS side.

**What changes.** One directive, on `packages/react/src/index.tsx`. Every value
that entry exports is built on hooks, context and refs, so there is no part of
the published surface the boundary would be wrong for. The same page now
builds, and the primitives render into the server pass and hydrate on the
client: the streamed HTML carries the viewport and the activation button, and a
click moves `data-state` off `dormant`.

**Nothing else gained one, and `@playdeck/core` deliberately did not.** No
package outside `@playdeck/react` imports a React API — core and the five
provider packages are framework-neutral — so a directive on any of them would
push framework-neutral code across a boundary it has no reason to cross, and
would stop a server component calling `detectSource` on the server. The RSC
route added to the Next integration imports `@playdeck/core` alongside the
primitives and uses it server-side, so that half is a measurement rather than
an assumption.

**Where it is enforced.** The directive is authored on the source entry and
carried to the top of the bundled chunk by the build, which is a property of
the build rather than of the file — so `pnpm test:packages` reads it back out
of the packed tarball, off the file the `exports` map's `import` condition
points at, for any package that names `react` in `peerDependencies`. A bundler
that stopped hoisting it, a `files` field that stopped shipping the entry, and
an `exports` map pointed somewhere else all fail there. The Next integration
covers the other end: its RSC route has no directive of its own, so the build
fails on that route if this one goes missing.

**Why `minor`, and what it can disturb.** No API, no type, no rendered output
and no runtime behaviour changed — the module's bindings are what they were.
What changed is the first line of the file a consumer's bundler reads, and a
bundler that does not implement directives may report it before ignoring it, so
an upgrade can add a warning to a build that had none. That is worth being able
to see in the version. While the major is `0`, `minor` is the slot for it.

**The ESM-only guarantee is untouched.** The export map, the `require`
condition and the two guard files are unchanged, and the directive lands on the
`import` entry only.
