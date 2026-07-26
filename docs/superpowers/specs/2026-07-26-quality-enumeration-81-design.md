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
the list.

`HlsLevelLike`'s three fields are all optional (`:34-38`) — audio-only
renditions carry no dimensions — so a missing field renders as the literal
token `-`: `hls:-x-@128000`. A level is never omitted from the list for lacking
dimensions. Filtering would leave a rung that `levels` holds and no id can
name, and silent filtering is the kind of thing that returns as a bug report.
Labelling a dimensionless rung is the consumer's problem, from `bitrate`.

`selectQuality(id)` resolves by recomputing ids over the live `levels` array and
matching. A rung that has been pruned yields
`{ ok: false, reason: 'unsupported' }`, which is the truthful answer rather than
a silent switch to a neighbour.

### Correction: the caption tiebreak this cites does not exist

An earlier draft of this section claimed the `:<idx>` suffix mirrors a
`hls:<lang>[:idx]` tiebreak already used for captions. **It does not.**
`hlsSubtitleTrackId` (`provider-hls:503-509`) is `hls:<track.id>` with a
fallback to `hls:<index>` — an id-or-index fallback, not a collision tiebreak,
and no language appears in it. The `:<idx>` shape here is new. It is still the
right shape, but it is being introduced, not followed, and nothing about it may
lean on a caption precedent for authority.

Noted and deliberately out of scope: that caption fallback branch is itself
index-derived, so it carries this same latent class. It is far lower risk —
hls.js does not prune `subtitleTracks` the way it prunes `levels` — and folding
it in would widen a spec that already touches three packages. If it deserves a
fix it deserves its own issue.

### The one place ids legitimately move

Two rungs identical in height, width **and** bitrate are distinguished only by
`:<idx>`. Pruning one changes the collision set, so the survivor's suffix can
shift. That is not the #57 class: rungs identical on every field this contract
exposes are mutually interchangeable, so repointing between them is not
observably wrong.

The stability test must therefore assert stability for **distinct** rungs and
must not accidentally build its fixture out of identical ones, or it will fail
for the wrong reason and get "fixed" by weakening the assertion.

## Per-provider behaviour

| Provider               | Behaviour                                                              |
| ---------------------- | ---------------------------------------------------------------------- |
| provider-hls, `hls.js` | Builds the list on `MANIFEST_PARSED`, refreshes on `LEVELS_UPDATED`.   |
| provider-hls, `native` | Unchanged — `unavailable/provider`, no list.                           |
| provider-native        | Capability fixed, see below. No list.                                  |
| provider-youtube       | Unchanged — `providerUnavailable` (`:95`). No list. Follow-up filed.   |
| provider-vimeo         | Unchanged — `unavailable/provider` (`:456`). No list. Follow-up filed. |

`selectQuality(null)` keeps setting `currentLevel = -1`.

### `LEVELS_UPDATED` is not the listener already there

`provider-hls:660` listens to **`LEVEL_UPDATED`** — singular, hls.js's
per-level-details event, which this adapter uses for the live hint. The refresh
this spec needs is **`LEVELS_UPDATED`** — plural, fired when the level _array_
changes, which is what pruning does. One letter apart, adjacent in the file,
and reusing the wrong one would silently disable the pruning refresh while
every other test still passed.

`LEVELS_UPDATED` is absent from the `HlsConstructorLike.Events` shim
(`:87-95`), so it must be added there and to every test fake. That shim is an
exported public type whose `Events` members are required, so this is a
technically breaking addition for anyone supplying a custom `HlsModuleLoader` —
free now, on the same unreleased-packages argument as the signature change.

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
count rather than on the engine being present — `resolveHlsCaptionRendering`
(`provider-hls:536-537`) gates on `hlsTextTracks.length === 0`. That citation
holds; the one in §"Id stability" did not.

**What it is when the list is empty.** Today `selectQualityAvailability` starts
`unknown/provider-check` (`:285-288`) and `MANIFEST_PARSED` flips it
unconditionally to `available` (`:653-655`). Gating on the list creates a state
the current code has no answer for: manifest parsed, list empty.

It resolves to `unavailable/source` — the same verdict, for the same reason, as
the `provider-native` fix below. Leaving it `unknown/provider-check` would
reintroduce the never-resolving verdict this spec exists partly to delete, one
provider over. `unknown/provider-check` remains correct **only** before the
manifest is parsed, where the check genuinely has not happened yet.

**A single-rung ladder reports `available`.** The list has one member, so the
capability is honest: that rung is selectable. Whether a one-item menu is worth
rendering is a consumer judgment, and `qualities.length > 1` is the consumer's
test to make. Gating the capability on `> 1` would bury a UX decision in a
provider.

## Lifecycle

`load()` and `retry()` both clear the list and reset the selection to auto.
`retry()` already resets `selectQualityAvailability` in exactly that place
(`provider-hls:809-812`).

### When the held selection is pruned out from under us

`selectQuality(prunedId)` returning `unsupported` covers the call. It does not
cover the selection already held when hls.js prunes that rung mid-playback —
`selectedQualityId` would keep naming a rung absent from `qualities`, and a menu
would render a checked radio item for a row it is no longer drawing.

The rule: on every list refresh, a held `selectedQualityId` that no longer names
a member resets to `null`. This is `resolveHlsTextTrackSelection`
(`provider-hls:519-530`) minus its default-track branch — "a held selection
persists as long as it still names an existing track, otherwise none" is
already this repo's rule, and quality has no `default` rung to fall back to.

**`currentLevel` is not written during that reset.** hls.js prunes levels as
part of its own error recovery and moves `currentLevel` itself; writing `-1`
into the middle of that is fighting the engine over state it is mid-way through
fixing. Reporting `null` is truthful about the selection this adapter is still
holding, which is none.

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
  §"Id stability" trap, asserted directly rather than trusted. The fixture's
  rungs must be **distinct**; see §"The one place ids legitimately move".
- Two rungs sharing height, width and bitrate get distinct ids via the `:idx`
  tiebreak.
- A level with no `height`/`width` gets the `-` token rather than `undefined` in
  its id, and is present in the list rather than filtered out.
- **The refresh is wired to `LEVELS_UPDATED`, not `LEVEL_UPDATED`.** Firing
  `LEVEL_UPDATED` alone must not refresh the list — without this assertion the
  two events are interchangeable in the fake and the pruning test passes on the
  wrong listener.
- **A held selection whose rung is pruned resets to `null`**, and the test
  asserts `currentLevel` was _not_ written during that reset.
- The capability is `unavailable/source` — not `unknown` — when the manifest
  parses with an empty list, and `available` for a single-rung list.
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
- [ ] No capability verdict anywhere in this contract can fail to resolve —
      `provider-native`'s permanent `unknown` is gone, and gating `provider-hls`
      on list length does not introduce a new one.
- [ ] A selection cannot outlive the rung it names.
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
