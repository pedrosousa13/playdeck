# React 18 support

`@playdeck/react` declares a peer range of `>=19 <20` for both `react` and
`react-dom`. A React 18 codebase cannot install it, and the range will not be
widened.

## Why this is out of scope

**It looks like a manifest edit and is not.** The peer range is the symptom; the
cause is that every primitive is written against React 19's ref-as-prop. There
is **no `forwardRef` anywhere in any package's source**, and
`ComponentPropsWithRef` — which carries `ref` as an ordinary prop — is used
across nine files of the React package: `captions.tsx`, `controls.tsx`,
`display-controls.tsx`, `gestures.tsx`, `loading-error.tsx`, `poster.tsx`,
`settings-menu.tsx`, `transport-controls.tsx` and `viewport-media.tsx`. That was
measured before this was declined, rather than assumed.

Under React 18 a function component does not receive `ref` as a prop, so every
primitive that accepts one would have to be wrapped in `forwardRef` again, and
every props type that spells `ComponentPropsWithRef` would have to change shape
to match. The published types change with them, so it is a breaking change to
the type surface as well as a rewrite of the primitives themselves.

**The testing cost is the durable half.** Supporting two React majors means
running the suite against both, forever, and the interesting failures are the
ones that only appear on one. That is a standing obligation on every future
change, not a one-off migration.

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

- #448 — "No no-build entry and no CommonJS, so reach stops at
  bundler-plus-React-19" (2026-08-24). Filed by the competitive comparison in
  #398. One of three packaging decisions bundled in that issue; declined by the
  maintainer on 2026-08-25, after the `forwardRef` and `ComponentPropsWithRef`
  measurement above.
