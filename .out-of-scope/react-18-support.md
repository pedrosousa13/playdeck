# React 18 support

`@playdeck/react` declares a peer range of `>=19 <20` for both `react` and
`react-dom`. A React 18 codebase cannot install it, and the range will not be
widened.

## Why this is out of scope

**It looks like a manifest edit and is not.** The peer range is the symptom; the
cause is that every primitive is written against React 19's ref-as-prop. There
is **no `forwardRef` anywhere in any package's source**, and
`ComponentPropsWithRef` — which carries `ref` as an ordinary prop — is used
across 14 files of the React package: `audio-tracks.tsx`, `captions.tsx`,
`chapters.tsx`, `controls.tsx`, `display-controls.tsx`, `gestures.tsx`,
`live-indicator.tsx`, `loading-error.tsx`, `playback-rate.tsx`, `poster.tsx`,
`quality.tsx`, `settings-menu.tsx`, `transport-controls.tsx` and
`viewport-media.tsx`. Nine of those were measured when this was first declined
(2026-08-25); `live-indicator.tsx`, `audio-tracks.tsx`, `playback-rate.tsx`,
`quality.tsx` and `chapters.tsx` are primitives built since, each written the
same way as the nine before it.

**The count is not a one-time cost — it grows with every new primitive.** Nine
in August, 14 a few weeks later, with no change of policy in between: each
primitive shipped since the decline took a `ref` the same way the others do,
because that is simply how a Playdeck primitive is written under React 19.
Nothing about a wider peer range would stop that growth; it would only mean a
bigger rewrite whenever this is next measured.

Under React 18 a function component does not receive `ref` as a prop, so every
primitive that accepts one would have to be wrapped in `forwardRef` again, and
every props type that spells `ComponentPropsWithRef` would have to change shape
to match. The published types change with them, so it is a breaking change to
the type surface as well as a rewrite of the primitives themselves.

**The testing cost is the durable half.** Supporting two React majors means
running the suite against both, forever, and the interesting failures are the
ones that only appear on one. That is a standing obligation on every future
change, not a one-off migration.

**Measured for real, not just reasoned about.** A maintainer ruling briefly
adopted React 18 on 2026-09-15, on condition that it be verified against a real
install rather than decided from the range alone. The verification ran the same
day. React 18.3.1
and React DOM 18.3.1 were installed as `packages/react`'s real
devDependencies, with `@testing-library/react` pinned alongside them so pnpm's
peer resolution anchored to 18 rather than the workspace's 19, and the
package's real test command was run.

**387 of 695 tests failed, across 17 of 29 test files.** The cause is single
and total: ref-as-prop. `Player.Root`'s own `ref` never reaches the component
under React 18, and that ref is how the test helpers — and any consumer —
reach the imperative handle, so sixteen further suites fail behind that one
loss. No other 18-vs-19 difference was found to affect this package: nothing
about `useSyncExternalStore`, `useId`, automatic batching or StrictMode effect
timing showed up as a cause anywhere in the failures.

**Why widening the range alone would be a regression, not a partial win.**
Today a React 18 project fails loudly at `npm install` — immediate and
unambiguous. A widened peer range would let that project install and then
silently drop every `ref` it passes to a Playdeck primitive, which a consumer
would not discover until whatever depended on the imperative handle quietly
did nothing. That is the same silent-failure shape this repo already fixed for
CommonJS: `esm-only.cjs` exists precisely so a CommonJS consumer fails at build
time instead of learning about it in production. Widening this range on its
own would introduce, on purpose, the failure mode that change was written to
close off.

**The reach argument is real and still loses.** #448 reports that of the four
libraries compared on 2026-08-24, Playdeck was the only one a React 18 codebase
could not install — Media Chrome accepting `>=17`, `@vidstack/react` accepting
`^18 || ^19`, `plyr-react` accepting `>=16.8`. Those three ranges are that
issue's measurement and are not re-verified here; none of the three is in this
repo's lockfile. Taken as reported it is the strongest of its three reach
findings, because it is the only one that excludes consumers already using
React. It is declined anyway: the cost is a rewrite of every primitive plus a
permanent two-major test matrix, which is a different project from the packaging
tweak it resembles.

```tsx
// React 19, and what the primitives are written against. `Controls` reads its
// own ref straight out of props; the rest let it ride the spread.
export type ControlsProps = ComponentPropsWithRef<'div'> & { … };
export const Controls = ({ ref, shortcuts, ...props }: ControlsProps) => …;

// What React 18 support would mean, on every primitive that takes a ref:
export const Controls = forwardRef<HTMLDivElement, ControlsProps>(…);
```

## This decision is reversible

The floor moves on its own. Every quarter that passes moves more of the React
ecosystem onto 19, so the population this excludes shrinks without anyone doing
anything — which is the opposite of most compatibility decisions and is why
waiting is cheap here.

What would justify revisiting is a named consumer that cannot move, rather than
a count of consumers who have not yet. If that turns up, scope it as its own
project with the `forwardRef` reintroduction, the props-type changes and the
two-major test matrix each costed, rather than as a change to the peer range.

## Prior requests

- #448 — filed by the competitive comparison in #398 (2026-08-24) as one of
  three bundled packaging decisions. Declined by the maintainer on 2026-08-25,
  after the `forwardRef` and `ComponentPropsWithRef` measurement above. A
  2026-09-15 ruling on the same issue briefly reversed that decline and asked
  for the range to be widened and verified against a real React 18 install.
  The measurement above is that verification; on reading it the maintainer
  reversed the ruling back to declined on 2026-09-16, which is the decision
  this file now records.
