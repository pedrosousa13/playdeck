### Issue #319: a non-fatal configuration notice must not paint a full-bleed error overlay

**This issue is the gate for cluster 1 of the v1 contract (#344).** #345 and its four
children (#330, #331, #332, #333) are `blocked` on it, and each of them publishes
_more_ non-fatal notices. Land this first or every one of those fixes makes the
overlay problem worse in proportion to how well it works.

## The decision, which the issue does not carry

#319's body ends at "The question for triage" and offers three candidate shapes,
explicitly none of them a recommendation. It has now been settled on #344:

> `ErrorDisplay` renders its overlay only when `error.fatal`. A non-fatal
> `configuration` notice is published to its own part with no default geometry
> and no `role="alert"`; a consumer targets `[data-playdeck-part="notice"]` and
> decides where it goes.

Do not relitigate this. The reasoning is the headless promise applied
consistently — nothing is rendered you did not compose — and it is what makes
cluster 1 safe to fix at all.

## What already exists

- `PlayerError.fatal` is a real field: `packages/core/src/types.ts:17`,
  `readonly fatal: boolean`. Nothing needs adding to core to read it.
- The two non-fatal errors today are both in `packages/core/src/safety.ts:43`
  and `:53` (`fatal: false`).
- `ErrorDisplay` currently ignores `fatal` entirely:
  `packages/react/src/loading-error.tsx:257-300`. It returns `null` only on
  `!error` (`:267`), then unconditionally renders `errorOverlayStyle`
  (`:251-255`: `position: absolute`, `inset: 0`, `zIndex: 40`) with
  `role="alert"` (`:283`).
- `recoverable` already gates the retry control (`:271-275`), and a
  `configuration` notice carries `recoverable: false` (#198) — which is why the
  overlay it paints today is not dismissible from the default rendering.

**Files:**

- Modify: `packages/react/src/loading-error.tsx` (the gate, plus the new part)
- Modify: `apps/storybook/stories/Contract.mdx` (`:15`, `:21` enumerate the
  error parts and must name the new one)
- Modify: `apps/storybook/stories/error-display.stories.tsx` (a story for the
  non-fatal case, which does not exist today)
- Check, do not assume: `apps/storybook/stories/parts.contract.test.ts`,
  `e2e/visual.spec.ts`, `e2e/a11y.spec.ts`, `e2e/a11y-media.spec.ts`,
  `apps/storybook/stories/reference/reference-player.tsx`,
  `apps/storybook/stories/activation.stories.tsx`

**Interfaces:**

- Produces: a `notice` part name that #345's children publish into. Agree the
  exact string here and record it in `Contract.mdx` before those are picked up —
  four issues will reference it.

## Steps

- [ ] **Step 1 — write the failing tests first.** Three, in
      `packages/react/test/`: a fatal error still renders the overlay with
      `role="alert"` and `inset: 0`; a non-fatal notice renders no overlay; a
      non-fatal notice is reachable at its own part. Red for the right reason
      before touching the component.

- [ ] **Step 2 — gate the overlay on `fatal`.** The narrow change in
      `loading-error.tsx`. Keep `recoverable` doing exactly what it does now;
      `fatal` and `recoverable` are separate axes and this issue only adds the
      first one to the render decision.

- [ ] **Step 3 — give the non-fatal notice its own part.** No default geometry,
      no `role="alert"`, no `zIndex`. It must render nothing visible until a
      consumer styles it. Carry `data-state={error.category}` as the overlay
      does, so the existing convention holds.

- [ ] **Step 4 — confirm the autoplay case changed too, deliberately.**
      `autoplayConfigurationError` (`packages/core/src/safety.ts:50-56`) is
      `fatal: false, recoverable: false` and produces the identical overlay
      today. #319's body is explicit that this is pre-existing behaviour, not
      something #235 introduced, and that changing it is part of the decision.
      Find the test that pins the current overlay for it and update it with a
      comment saying why — do not delete it.

- [ ] **Step 5 — sweep the consumers.** `ErrorDisplay` appears in ten files
      (list above). Two are the reference composition and the a11y suites, so a
      changed render surface can move an axe scan or a visual baseline. Run
      `pnpm test:e2e --project=visual` and regenerate baselines through
      `visual-baselines.yml` if and only if they legitimately move.

- [ ] **Step 6 — document the part.** `Contract.mdx:15` and `:21` enumerate
      `error-message` / `error-retry` in prose; add the new part there in the
      same voice, and say plainly that it has no default appearance.

## Acceptance criteria

- [ ] A fatal error renders exactly what it renders today — overlay, `inset: 0`,
      `zIndex: 40`, `role="alert"`, and a retry control when `recoverable`.
- [ ] A non-fatal notice renders no overlay and no `role="alert"`, and covers
      nothing. A playing video stays fully visible while one is published.
- [ ] A non-fatal notice is reachable from the DOM at a stable part name, and
      that name is documented in `Contract.mdx`.
- [ ] The muted-autoplay configuration conflict goes through the same path, and
      the test that used to pin its overlay states why it changed.
- [ ] `pnpm test`, `pnpm test:storybook`, the e2e suite and the visual suite all
      pass. Any moved baseline is regenerated through the workflow, never by
      hand.
- [ ] A changeset. This is a visible behaviour change for anyone composing
      `ErrorDisplay` today, so it is not a silent patch.

## Out of scope

- Publishing any _new_ notice. That is #330, #331, #332 and #333, all of which
  wait on this.
- A diagnostics prop, a debug mode or a logging channel — #235's brief put those
  out of scope and nothing here reopens them.
- The single-slot `#configurationNotice` in the controller. That is #332.
