# Enumerate selectable qualities in public state (#81)

Design, 2026-07-26. Parent: #1. **Blocks #67.**

## Why this exists

`selectQuality` is a reported capability, and the primitives give consumers no
way to build the control it implies.

```ts
// packages/core/src/index.ts:111-115, :149
export type PlayerQuality = {
  readonly height: number | null;
  readonly width: number | null;
  readonly bitrate: number | null;
};
readonly quality: PlayerQuality | null;

// :867
selectQuality = (height: number | null): Promise<CommandResult> =>
  this.#command('selectQuality', height);
```

A consumer can call `selectQuality(720)` but cannot discover whether 720 exists.
hls.js holds the ladder (`packages/provider-hls/src/index.ts:68`, `levels`) and
`:841` already searches it to resolve a requested height — none of it reaches
`PlayerState`.

Found while designing #67, the composed reference example, whose settings menu
needs a quality group and cannot have one. Same class as #15 shipping
`MediaProps` without `children`.

## The second half of the gap

`quality` is emitted from `LEVEL_SWITCHED` (`provider-hls:640-652`), so it is
the level **playing right now**. Under adaptive selection it moves on its own.
It therefore cannot answer "what did the user choose" — "user picked 720" and
"auto happens to be at 720" are the same value.

A menu needs both: the selection to check a radio item, and the active level to
label the auto row honestly.

## The contract

Mirrors the text-track contract exactly, so there is one vocabulary for "list,
selection, active" rather than two.

| Field                                 | Status    | Meaning                                     |
| ------------------------------------- | --------- | ------------------------------------------- |
| `qualities: readonly PlayerQuality[]` | new       | What can be selected. Empty when none.      |
| `selectedQualityId: string \| null`   | new       | What the consumer chose. `null` means auto. |
| `quality: PlayerQuality \| null`      | unchanged | What is playing right now.                  |

`PlayerQuality` gains `id: string`. The command becomes:

```ts
selectQuality = (id: string | null): Promise<CommandResult>;
```

`null` means auto, the way `selectTextTrack(null)` means off. The example in #67
renders an explicit "Auto" row, the way it renders an explicit "Off" row for
captions — neither is a member of the list.

Keeping `quality` as the active level is what lets a menu render
`Auto (1080p)`: under auto, `selectedQualityId` is `null` while `quality` moves.

### Why an id and not the height

The packages are unreleased, so the signature change is free now and a breaking
change after the prerelease.

A real ladder can carry two rungs at the same height and different bitrates.
`levels.findIndex((level) => level.height === height)` (`provider-hls:841`)
silently takes the first, so the second rung is unreachable and a
height-keyed menu would show two identical `1080p` rows that do the same thing.

Blast radius is contained: `packages/core/test/hls-state.test.ts` and
`packages/provider-hls/test/index.test.ts` are the only callers. No e2e, no
react code, no stories.

## Id stability — the trap

**Not `hls:<index>`.** hls.js removes levels from the array after repeated
errors, so indices shift and a held selection would silently repoint to a
different rung. That is the #57 bug class: an id that looks stable and is not.

The id is content-derived:

```
hls:<height>x<width>@<bitrate>
```

with a `:<idx>` suffix appended only for entries whose base id collides inside
the list — the same tiebreak `hls:<lang>[:idx]` already uses for captions.

`selectQuality(id)` resolves by recomputing ids over the live `levels` array and
matching. A rung that has been pruned yields
`{ ok: false, reason: 'unsupported' }`, which is the truthful answer rather than
a silent switch to a neighbour.

## Per-provider behaviour

| Provider               | Behaviour                                                              |
| ---------------------- | ---------------------------------------------------------------------- |
| provider-hls, `hls.js` | Builds the list on `MANIFEST_PARSED`, refreshes on `LEVELS_UPDATED`.   |
| provider-hls, `native` | Unchanged — `unavailable/provider`, no list.                           |
| provider-native        | Capability fixed, see below. No list.                                  |
| provider-youtube       | Unchanged — `providerUnavailable` (`:95`). No list. Follow-up filed.   |
| provider-vimeo         | Unchanged — `unavailable/provider` (`:456`). No list. Follow-up filed. |

`selectQuality(null)` keeps setting `currentLevel = -1`.

### provider-native's permanent unknown

`packages/provider-native/src/index.ts:292` declares
`selectQuality: { status: 'unknown', reason: 'provider-check' }` and nothing ever
resolves it — `mediaCapabilities()` returns the same literal on every
recomputation. A consumer gating a quality menu on that capability waits on a
verdict that never arrives.

It becomes `{ status: 'unavailable', reason: 'source' }`. A plain media element
has no ladder to choose from, and `source` is the vocabulary already used for
"this source offers none" (finding #7 of the caption fix wave).

### Capability follows the list

`selectQuality` is `available` only when the list is non-empty. This is the
precedent from the hls.js caption work, where the capability was gated on track
count rather than on the engine being present.

## Lifecycle

`load()` and `retry()` both clear the list and reset the selection to auto.
`retry()` already resets `selectQualityAvailability` in exactly that place
(`provider-hls:809-812`).

No `hasExplicitSelection` machinery. Captions needed it because a source swap
had to re-honour a new `default` track and not clobber a user's held choice.
Quality has no per-source default worth preserving, and carrying a rung across a
source swap would mean matching bitrate ladders that have nothing to do with
each other. Auto is the correct starting state for a new source.

In core, `qualities` is copied and frozen in `#applyPatch` alongside
`textTracks`, `buffered`, `seekable` and `capabilities` — finding #8 of the
caption fix wave established that shape.

## React

No new API. `usePlayerState` already selects arbitrary state, so
`usePlayerState((state) => state.qualities)` works the day this lands. The
consumer that proves it is #67's reference example.

## Testing strategy

Red first, per the repo's practice.

**core**

- `qualities` initial value and `selectedQualityId` initial value.
- `qualities` is copied and frozen by `#applyPatch`; mutating the patch array
  afterwards does not reach state.
- `selectQuality` forwards the new `string | null` signature; unsupported and
  not-ready paths unchanged.

**provider-hls**

- The list is built from `levels` after `MANIFEST_PARSED`, with ids, and
  refreshed on `LEVELS_UPDATED`.
- **Ids survive a level being pruned.** Remove a level from the fake's array,
  refresh, and assert the surviving rungs keep the ids they had — this is the
  §"Id stability" trap, asserted directly rather than trusted.
- Two rungs sharing height, width and bitrate get distinct ids via the `:idx`
  tiebreak.
- `selectQuality(id)` switches to the right level; `selectQuality(null)` sets
  `currentLevel = -1`; an id not in the list returns `unsupported`; an id for a
  pruned rung returns `unsupported`.
- `selectedQualityId` reflects the selection and is `null` after auto.
- The capability is `available` only while the list is non-empty.
- `load()` and `retry()` clear the list and reset the selection.

**provider-native**

- The capability is `unavailable/source`, and no longer a never-resolving
  `unknown`.

**e2e**

None new. #67's reference example is the end-to-end consumer, which is the
point of #67.

## Acceptance criteria

- [ ] Public state enumerates the selectable qualities for the hls.js engine.
- [ ] The selection is readable separately from the active level.
- [ ] Ids are stable across level pruning, proven by a test that fails if they
      are index-derived.
- [ ] `provider-native` no longer reports a capability verdict that never
      resolves.
- [ ] A quality menu can be built from public exports alone — demonstrated by
      #67.

## Out of scope

- Quality selection for YouTube and Vimeo. Filed separately; both currently
  declare the capability unavailable and wire no command, so nothing regresses.
- Any react-level quality component. The primitives compose one from
  `SettingsMenu` + `MenuRadioGroup`, which #67 demonstrates.
- Bitrate or bandwidth display beyond the fields `PlayerQuality` already
  carries.

## Verification

```sh
pnpm test && pnpm typecheck && pnpm lint
```

Plus the full gate set, unpiped, and `prettier --check` on changed files only —
repo-wide `format:check` fails locally on gitignored `.planning/**`.
