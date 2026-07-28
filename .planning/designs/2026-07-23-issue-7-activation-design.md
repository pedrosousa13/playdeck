# Issue #7: Lazy Activation Design

**Status:** Approved design  
**Issue:** [#7 — Lazy activation strategies + provider loader registry](https://github.com/pedrosousa13/reely/issues/7)  
**Depends on:** #6, merged on `main`  
**Followed by:** #19, using Storybook `10.5.3`

## Goal

Add deterministic provider activation to the React player without conflating
three independent policies:

1. Poster loading, controlled by image attributes.
2. Provider activation, controlled by `loading` and `loadMargin`.
3. Media preload, controlled by the native `preload` attribute after a media
   element exists.

The implementation must preserve server rendering, prevent provider contact
before interaction when requested, invalidate stale asynchronous activation,
and keep provider packages outside inactive initial bundle graphs.

## Design principles

- `Player.Root` is the deep module. Callers choose a strategy; Root hides
  observers, dynamic imports, mount coordination, generation tokens, queued
  playback, retry behavior, and cleanup.
- The provider-loader seam is private to `@reely/react`. Tests use a fake
  adapter at this internal seam, but no loader registry, mutation function, or
  test-only prop becomes public.
- The framework-neutral core owns normalized activation state, provider
  lifecycle, commands, and events. It does not know about React,
  `IntersectionObserver`, dynamic imports, or DOM mounts.
- Public visual primitives stay minimal: one activation button that owns the
  overlay behavior, plus one reusable loading indicator.
- Every new public interface corresponds directly to the locked issue
  contract. No future-provider customization interface is added.

## Public interface

```ts
export type PlayerLoadingStrategy = 'eager' | 'viewport' | 'interaction';

export type PlayerPreload = 'none' | 'metadata' | 'auto';

export type PlayerActivationProps = {
  readonly loading?: PlayerLoadingStrategy;
  readonly loadMargin?: string;
  readonly preload?: PlayerPreload;
};
```

`RootProps` includes `PlayerActivationProps`.

- `loading` defaults to `'viewport'`.
- `loadMargin` defaults to `'200px 0px'`.
- `preload` defaults to `'metadata'`.

The visual interface consists of:

```tsx
<Player.Root source={source} loading="interaction" preload="metadata">
  <Player.Viewport>
    <Player.Media />
    <Player.Poster>{/* decorative poster */}</Player.Poster>
    <Player.ActivationButton />
    <Player.LoadingIndicator />
  </Player.Viewport>
</Player.Root>
```

### `Player.ActivationButton`

`ActivationButton` is the single activation-overlay primitive. It renders a
real `<button type="button">`, owns the overlay layer at z-index 30, and exposes:

- `data-reely-part="activation"`
- `data-state="dormant" | "eligible" | "loading-provider" | "error"`
- an accessible default label of `Play video`
- an error-state default label of `Retry loading video`

It accepts ordinary button presentation props and replacement children.
Consumer click handlers run first; activation proceeds unless the event was
prevented. During `loading-provider`, the button remains present and focusable
with `aria-disabled="true"` so a click does not start a second activation and
focus is not discarded. It is absent once activation is ready and for
non-interaction strategies.

On an activation error, clicking the same button retries the current source.

### `Player.LoadingIndicator`

`LoadingIndicator` is separate because it represents two conditions:

- provider activation: `data-state="loading-provider"`
- playback buffering: `data-state="buffering"`

It renders a polite status only while one of those conditions is active and
uses `data-reely-part="loading-indicator"`. Provider loading takes precedence
if both conditions are true. It accepts ordinary `<div>` presentation props
and replacement children. It occupies the fixed status layer at z-index 30
without accepting pointer input.

### `Player.Viewport`

`Viewport` remains the sole positioning context. It privately registers its
DOM element with Root for viewport activation while preserving a consumer
ref. `loading="viewport"` requires a `Player.Viewport` descendant; omission
produces a recoverable configuration error and never falls back to eager
activation.

### `Player.Media`

`Media` does not create a provider element during SSR or while activation is
dormant. After eligibility, it creates the appropriate mount. For native
video, it forwards Root's `preload` value to `<video>` instead of hard-coding
`metadata`.

`preload` does not activate a provider. It only controls browser behavior once
the media element exists.

## Internal modules and seams

### Core activation transition

`PlayerController` gains one narrow operation for pre-provider activation
state. It may publish `dormant`, `eligible`, `loading-provider`, or `error`
before a provider is installed. It cannot publish `ready`; provider state is
the only source of readiness.

The operation:

- preserves immutable `PlayerState` snapshots;
- pairs `dormant` and `eligible` with an idle lifecycle,
  `loading-provider` with a loading lifecycle, and `error` with an error
  lifecycle;
- accepts a normalized error only for `error`;
- clears an earlier activation/configuration error when a new attempt begins;
- never imports code or touches browser APIs;
- is not exposed through `PlayerHandle` or `usePlayerActions`.

`setProvider()` continues to own installed-provider lifecycle and the
`loading-provider → ready | error` transition after an adapter exists.

### Private provider loader

`packages/react/src/provider-loaders.ts` defines an internal loader interface
whose inputs are the detected source, the current provider mount, and native
playback options. Its result is a `ProviderAdapter`.

The native loader dynamically imports `@reely/provider-native`; the existing
static import is removed from the React entry module. Other provider packages
are not created or faked in production for this issue. Later provider issues
add their adapters to the same private registry.

Tests replace this private module with a deterministic fake adapter. No fake
provider is published.

### Activation session

Root owns an activation session identified by:

- the committed source key;
- a monotonically increasing generation;
- the current loading strategy;
- whether user-origin playback is queued;
- the active observer, import, mount, and adapter.

The generation increments on source change, strategy restart, retry, and
unmount. Every asynchronous continuation verifies both source key and
generation before changing state or installing an adapter. A stale adapter is
destroyed if it was already created; stale import results are otherwise
ignored.

This React-side guard covers the period before `PlayerController.setProvider`
can apply its existing provider-generation protection.

## Strategy behavior

### Eager

1. SSR renders children without media or provider activation.
2. A client effect marks the source eligible.
3. Media supplies its mount.
4. Root starts the private loader and publishes `loading-provider`.
5. Root installs the current adapter.
6. Provider events confirm `ready` or `error`.

### Viewport

1. SSR renders the Viewport and poster without media.
2. On mount, Root observes Viewport with the configured `rootMargin`.
3. Nothing imports before an intersecting entry.
4. The first intersection marks the source eligible and disconnects the
   observer.
5. Loading then follows the eager path.

Changes to `loadMargin` restart only a still-dormant observer. They do not
replace an active or ready provider.

If `IntersectionObserver` is unavailable, Root reports a recoverable
unsupported-category error explaining that the browser lacks the required
observer. It does not silently change the strategy.

### Interaction

1. SSR renders the poster and activation button, but no media element,
   provider import, SDK, iframe, or observer.
2. The first activation-button click records a queued play with origin
   `user`, marks the source eligible, and starts loading.
3. The media mount and dynamic import may resolve in either order.
4. Once both exist, Root installs the adapter.
5. When the adapter is ready, Root attempts the queued play once with origin
   `user`.

If the effective initial muted state is true, the provider receives that
preference before queued playback. Audible playback is never retried as muted.
If it resolves `blocked`, the ordinary visible Play action remains available.

The same click never starts multiple imports or multiple queued plays.

## Errors and retry

The following are recoverable configuration errors:

- `loading="interaction"` with `autoplay="muted"` or
  `autoplay="audible"`;
- `loading="viewport"` without a registered Viewport.

Configuration errors are represented in `PlayerState` rather than thrown from
render. They perform no provider import.

Loader, adapter creation, attach, and load failures produce:

- `lifecycle: "error"`
- `activation: "error"`
- a normalized provider error

Interaction mode retains the activation button as a retry affordance. Retry
creates a new activation generation for the current source and never revives a
stale attempt.

Changing source clears an earlier source's activation error before evaluating
the new strategy.

## SSR and privacy

At server-render time:

- source detection may run;
- Viewport, Poster, and PosterImage may render;
- ActivationButton renders for interaction mode, while LoadingIndicator is
  absent because no loading or buffering condition exists yet;
- no media element, provider import, observer, SDK, iframe, or autoplay attempt
  is created.

In interaction mode, no provider-domain or media-source request occurs before
the activation click because no provider mount exists. Poster requests remain
governed solely by poster image attributes.

## Verification design

### Core tests

Core tests cover the pre-provider activation operation:

- valid dormant/eligible/loading/error transitions;
- immutable snapshots;
- ready cannot be fabricated without provider confirmation;
- configuration errors clear only on a new valid attempt;
- installed-provider generation behavior remains unchanged.

### React tests

A dedicated activation test file uses Testing Library, happy-dom, a controlled
`IntersectionObserver`, deferred promises, and a fake provider adapter.

Tests cover:

- eager activation after client mount;
- viewport default and custom margins;
- no import before intersection;
- observer disconnect and cleanup;
- missing Viewport and missing IntersectionObserver errors;
- interaction SSR markup;
- zero loader calls before click;
- one click loading, adapter installation, and user-origin queued playback;
- muted success and audible blocked behavior without silent muting;
- interaction/autoplay configuration errors;
- retry after loader failure;
- source A → B invalidation before A's import resolves;
- unmount invalidation;
- media `preload` forwarding without activation side effects;
- poster behavior remaining independent;
- ActivationButton and LoadingIndicator semantics and state attributes.

No behavior is duplicated from existing provider contract or poster tests.

### Browser privacy test

`e2e/activation.spec.ts` uses an intercepted external-looking MP4 URL as a
deterministic fake provider origin:

1. Register request observation and routing before navigation.
2. Render an interaction-loading player.
3. Assert no matching request before activation.
4. Click the accessible activation button once.
5. Assert the first matching request occurs only afterward.

The route serves deterministic local bytes; no real provider or external
service is contacted.

### Bundle fixture

The placeholder `test:bundle` becomes a real Vite consumer fixture under
`tests/bundle/native-only`.

The fixture:

- consumes built `@reely/react` as a package;
- walks the Vite manifest's initial static-import closure;
- verifies provider adapters are outside that closure;
- records browser script requests in interaction mode;
- verifies the native provider chunk is not requested before activation and is
  requested afterward;
- provides the baseline forbidden-provider list that later HLS, YouTube, and
  Vimeo issues extend.

Lazy chunks may exist on disk. Tests inspect the initial graph and actual
requests rather than rejecting all emitted chunks.

### Documentation and CI

The docs app explains:

- poster loading vs provider activation vs media preload;
- all strategies and defaults;
- `loadMargin`;
- viewport composition requirements;
- interaction consent and autoplay incompatibility;
- muted and audible one-click behavior;
- retry and source-change behavior.

Issue verification remains:

```sh
pnpm --filter @reely/react test
pnpm test:e2e -- --grep activation
pnpm test:bundle
```

Before completion, the full repository gate also runs formatting, lint,
typecheck, unit tests, all browser tests, package builds, bundle checks,
integration tests, and the root build.

No new dependency requiring a pnpm build approval is introduced. The existing
`sharp@0.34.5` allowlist remains unchanged.

## Alternatives rejected

### Dynamic loading in core

Rejected because it makes framework-neutral core understand browser imports,
mounts, observers, and React timing.

### Public loader registry or Root injection prop

Rejected because it exposes an interface callers do not need and creates
permanent compatibility obligations primarily for tests.

### Three public activation primitives

Rejected as shallow interface surface. A separate overlay wrapper adds caller
knowledge without hiding meaningful implementation. ActivationButton can own
the overlay behavior directly.

### Reusing PlayButton as the consent gate

Rejected because PlayButton represents commands against an installed provider.
Before activation it returns `not-ready`, and it cannot represent provider
loading or activation retry semantics cleanly.

### Rendering media immediately but delaying `load()`

Rejected because media or iframe creation can itself initiate requests and
would violate the interaction privacy guarantee.

## Success criteria

The design is successful when:

- all three strategies are deterministic and independently observable;
- interaction performs no provider or media request before one explicit click;
- source changes and unmounts cannot install stale adapters;
- muted queued playback is attempted from the activation click and audible
  playback is never silently downgraded;
- public activation interface is limited to Root props, ActivationButton, and
  LoadingIndicator;
- provider-loader seams remain private;
- SSR contains the poster and interaction control but no provider mount;
- the native-only initial graph contains no inactive provider adapter;
- root verification stays green;
- issue #19 can build deterministic stories for every activation and loading
  state using Storybook `10.5.3`.
