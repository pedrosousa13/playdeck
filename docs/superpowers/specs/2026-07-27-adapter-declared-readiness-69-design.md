# Adapter-declared command readiness (#69) — design

Issue: [#69](https://github.com/pedrosousa13/reely/issues/69). Prior attempt: [PR #72](https://github.com/pedrosousa13/reely/pull/72), **closed unmerged after two review rounds**. Blocker [#74](https://github.com/pedrosousa13/reely/issues/74) is now fixed, which is what makes this testable.

## What #69 actually is, after two corrections

The issue's original headline — that pre-attach commands return `ok: true` and are silently clobbered — was retracted by the owner. Measured, they return exactly `{ok: false, reason: 'not-ready'}` from the provider-presence guard (`packages/core/src/index.ts:889`, `:896`, `:994`). A second retraction removed the claim that `Player.PlayButton` is exempt: it reaches the same guard, and `ActivationButton`, which owns the activation path, is `aria-disabled` during `loading-provider`.

What is left is smaller and real: **the UI is interactive while every command is refused, and there is no signal a consumer can await.** The only route today is polling `getState().activation`, which is wrong for at least one provider (see below).

## Why PR #72 failed, and the constraint that survives it

Both shapes of `whenReady()` were wrong, in opposite directions:

| Settled at               | Failure                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| provider attach          | **False-ready** for YouTube, Vimeo, and the hls.js path — those adapters build the underlying player inside `load()`, so a command issued the instant the promise resolved still answered `not-ready`. Verified against a fake-SDK harness.                                                                                                                                                                                                      |
| `activation === 'ready'` | **Hangs.** Native with `preload="none"` accepts commands from birth but stays `loading-provider` until a play triggers metadata load (`use-activation.ts:504-517` already encodes this asymmetry). Vimeo behind a blocked iframe keeps `activePlayer` live while `await player.ready()` never resolves. And every `recoverable` error hangs, because `toProviderError` (`core/src/index.ts:368-376`) stamps `recoverable: true` unconditionally. |

The surviving constraint, in the owner's words: **"a command will be accepted" is per-provider knowledge core does not have.** No state transition core can derive means the same thing across all four providers. The declaration has to come from the adapter.

## The definition

`commandsReady: true` means:

> A command issued now is accepted by this provider **and will not be undone by a load that has not run yet.**

The second clause is not decoration, and it is the part a purely guard-based flag gets wrong.

`provider-native`'s commands operate on the media element directly (`runCommand` closes over `media`), so its guards are open from adapter construction. But the HTML media load algorithm sets `playbackRate` to `defaultPlaybackRate`, so a rate applied before `media.load()` is reverted by it. That is the original #69 symptom exactly — a rate that fails to apply. A flag that reported ready at guard-open would report ready and still no-op, reproducing the bug through the new API.

So each adapter declares readiness at the point where its own commands both land and stick.

## Core contract

**New state field.** `PlayerState.commandsReady: boolean`, `false` in `createInitialPlayerState()` (`core/src/index.ts:329-357`). Adapters publish it through the existing `emit()`/`ProviderStatePatch` channel — `ProviderStatePatch` is already `Partial<PlayerState>` (`:206`), so no adapter plumbing is added and no existing patch literal breaks.

**Reset points.** Back to `false` whenever the claim could go stale:

- `setProvider` — already rebuilds from `createInitialPlayerState()` on every generation bump (`:733`, `:755`), so this falls out for free.
- `retry()` — its reload patch (`:938-942`) sets `lifecycle: 'loading'` / `activation: 'loading-provider'`; `commandsReady: false` joins it. All four adapters implement `retry` and all of them rebuild or reload their playback target, so the previous declaration is genuinely void.
  - **And it must be restored on the way out.** `retry()`'s failure branch (`:960-966`) puts `lifecycle`, `activation` and `error` back from `previousState` when the command returns `!ok` without an error. `commandsReady: previousState.commandsReady` joins that restore, or a refused retry strands a provider that never stopped accepting commands at `false` until its next emit. The error branch (`:955-959`) correctly leaves it `false`.

**New method.** `whenReady(): Promise<boolean>` on `PlayerController`.

- Resolves `true` when `commandsReady` becomes true; resolves synchronously-available `true` if it already is.
- Resolves `false` when an attempt that existed is abandoned: detach (`setProvider(undefined)`, which is also what provider destruction runs through — `PlayerController` has no `destroy` of its own), provider swap, or a **fatal** error.
- **Waits, rather than answering `false`, when no provider has ever been attached.** The React layer attaches in an effect, so a consumer call that lands first is a race, not an answer, and a spurious `false` is unrecoverable — the consumer has already skipped the command it was waiting to issue. For the same reason a swap only settles waiters that were registered against a provider that actually existed.
- **Never rejects and never hangs on an outcome.** Settling `false` is precisely what neither #72 shape could do.

Waiters are held in a `Set` and settled from the same place the flag is patched. A non-fatal (`recoverable`) error does **not** settle the promise — recovery is expected and `retry()` may still reach ready. That is the deliberate opposite of #72's reading, which treated `recoverable` as transient and hung on all of them.

**Unchanged, deliberately:** the `#command` provider-presence guard, every `not-ready` refusal, and the `activation` union. This ships a signal, not a behaviour change. A command issued before readiness is still refused, still synchronously, still with the same reason.

## Per-adapter declaration sites

| Provider                      | Emits `commandsReady: true` at                                               | Why there                                                                                                                                                                                                                                                                             |
| ----------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `provider-native`             | inside `load()`, after `media.load()` (`src/index.ts:628-636`)               | guards are open earlier, but `media.load()` resets `playbackRate` to `defaultPlaybackRate`. Reports ready while `activation` stays `loading-provider` under `preload="none"` — the asymmetry #72 mishandled.                                                                          |
| `provider-hls`, native engine | after `media.src = source.src; await native.load()` (`src/index.ts:892-898`) | same reasoning; the native adapter underneath owns the commands (`play: native.play`, …, `:918-930`).                                                                                                                                                                                 |
| `provider-hls`, hls.js engine | on `MEDIA_ATTACHED`                                                          | `attachMedia` (`:862`) swaps in an MSE blob source, re-running the load algorithm. Declaring before it repeats the native clobber. **Not** `MANIFEST_PARSED` (`:802`) — commands land and stick before the manifest resolves, and a manifest that never parses would strand the flag. |
| `provider-youtube`            | in the `onReady` callback (`src/index.ts:560`)                               | `guardReady()` (`:599`) refuses until the player exists, and the YouTube iframe API discards calls made before `onReady`.                                                                                                                                                             |
| `provider-vimeo`              | at `activePlayer` assignment (`src/index.ts:756`)                            | `runCommand` (`:865-869`) opens exactly there. **Not** `await player.ready()` (`:770`) — that never resolves behind a blocked iframe, which is one of the two hangs that closed #72. The Vimeo SDK queues calls internally, so commands issued between the two points still land.     |

Each site is pinned by a test that fails before the emit is added.

## React layer

No new API. `commandsReady` flows through `usePlayerState` like any other field:

```tsx
const commandsReady = usePlayerState((state) => state.commandsReady);
useEffect(() => {
  if (commandsReady) void actions.setPlaybackRate(0.75);
}, [commandsReady, actions]);
```

Imperative consumers get the awaitable instead:

```ts
if (await controller.whenReady()) void controller.setPlaybackRate(0.75);
```

## Testing

#74's fix (`provider-native` now uses the inlined `HAVE_METADATA` rather than the `undefined` static, which made every comparison false under happy-dom) is what unblocks this. Native and hls can finally reach `activation: 'ready'` in the unit environment, so:

- **native and hls tests use real adapters**, not the hand-written `{lifecycle: 'ready', activation: 'ready'}` mocks that both #72 branches were forced into and that asserted nothing about real provider paths.
- **youtube and vimeo** use the existing fake-SDK harness — the same one that caught #72's false-ready.

Coverage:

1. Per provider: `commandsReady` is `false` through attach and turns `true` at the declared site, not before.
2. Native with `preload="none"`: `commandsReady` is `true` while `activation` is still `loading-provider`.
3. `whenReady()` resolves `true` after the flip; resolves `true` immediately when already ready.
4. `whenReady()` resolves `false` on detach, on destroy, and on a fatal error — each asserted to settle, not hang.
5. `whenReady()` does **not** settle on a `recoverable` error.
6. `commandsReady` returns to `false` across `setProvider` and across `retry()`, and a `retry()` that is refused without an error restores the pre-retry value rather than stranding it at `false`.
7. A rate applied at `commandsReady` survives — the regression test for the definition's second clause.

Every test is falsified against unpatched code before it is trusted. Two tests in session 10 were green by construction until checked.

Cross-package runs use the root config: `npx vitest run --root . <path>`.

## Docs and changeset

- Replace the "poll `getState().activation`" guidance with `commandsReady` / `whenReady()`, and state plainly that commands before readiness are refused with `{ok: false, reason: 'not-ready'}`.
- Changeset entry for the new state field and the new controller method.

## Non-goals

- **No queue or replay.** Rejected explicitly: replaying needs staleness rules (superseded `setVolume`/`mute` pairs, seeks that outlive their source, generation swaps) and makes every `CommandResult` resolve late. The signal is the missing primitive; a queue can be layered on it later without breaking this contract.
- **No `activation` change.** Widening that union to carry command readiness is the ambiguity that sank #72.
- **No change to refusal behaviour.** Pre-ready commands keep returning `{ok: false, reason: 'not-ready'}`.

## Budget

Core is 4.93 KB against a 10 KB budget. One boolean field, one method, and a waiter set.
