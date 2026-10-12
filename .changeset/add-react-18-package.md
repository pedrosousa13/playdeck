---
'@playdeck/react-18': minor
---

Introduces `@playdeck/react-18`: `@playdeck/react`'s primitives, built at build time from the same source, for a React 18 peer range (`>=18.3 <19`) instead of React 19's. Same exports, same types, no `./browser` entry. A JSX-runtime shim and `forwardRef` wrapping of every exported component whose props accept a `ref` give it `@playdeck/react`'s React 19 ref-as-prop and ref-cleanup behaviour on top of React 18. Released in lockstep with the fixed group.
