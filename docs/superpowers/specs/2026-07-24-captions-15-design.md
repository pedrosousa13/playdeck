# Native/HLS captions: hybrid rendering (#15)

**Issue:** #15 (parent #1). Blocked by #13 (HLS), #8 (styling contract) — both landed. Feeds the YouTube/Vimeo captions issue (next) and #9 (preset composes the overlay).

## Goal

Add captions to native media and HLS as a **hybrid** model (locked at product level): custom-render WebVTT cues in our own overlay by default, let consumers opt into native browser rendering, and report the effective mode honestly. Define the contracts provider-neutrally so the YouTube/Vimeo issue plugs in without reshaping them.

**Locked a11y decision:** caption cues are visual media content, **not** live-region announcements. Cue text never enters an `aria-live` region — that would make a screen reader read the entire film. Only meaningful control changes ("English captions on") are announced, once.

## Contract inherited from #8 (do not break)

- Stable `data-reely-part` / `data-state` / `data-provider` attributes + ARIA state.
- `className` / `style` / `ref` passthrough; `{...props}` spread; replaceable children.
- Selector-gated `usePlayerState` — new PlayerState fields re-render only their subscribers.
- `capabilities.selectTextTrack` Availability + `controller.selectTextTrack(id | null)` command already scaffolded in core; reuse them.

## Architecture: two channels

Track metadata and selection are **low-frequency** (change on load / user action). Active cues are **high-frequency** (change multiple times per second). They travel on separate channels so cue churn never rewrites the player state object.

### Low-frequency → `PlayerState` (via existing `ProviderStatePatch`)

```ts
readonly textTracks: readonly TextTrack[];
readonly selectedTextTrackId: string | null;   // null = off (single source of truth)
readonly captionRendering: 'custom' | 'native' | 'provider' | 'unavailable';
```

### High-frequency → dedicated cue channel (NOT in `PlayerState`)

```ts
// Controller
subscribeCues(listener: (cues: readonly TextCue[]) => void): () => void;
// React
useActiveCues(): readonly TextCue[];   // useSyncExternalStore; only Player.Captions subscribes
```

## Core contracts (`@reely/core`)

```ts
export type TextTrackKind = 'subtitles' | 'captions';
export type TextTrackReadiness = 'idle' | 'loading' | 'loaded' | 'error';

export type TextTrack = {
  readonly id: string;                // provider-namespaced, stable for the loaded source's lifetime
  readonly label: string;             // human label; falls back to a language-derived label
  readonly language: string | null;   // BCP-47 or null
  readonly kind: TextTrackKind;
  readonly readiness: TextTrackReadiness;
};

export type TextCue = {
  readonly id: string | null;
  readonly startTime: number;
  readonly endTime: number;
  readonly text: string;              // plain text; newlines preserved for multi-line cues
};
```

- `createInitialPlayerState()` gains `textTracks: []`, `selectedTextTrackId: null`, `captionRendering: 'unavailable'`. Frozen like the rest.
- **No `selected` flag on the track.** Selection lives only in `selectedTextTrackId`; `off` is `null`.
- **Cue normalization is deliberately minimal.** WebVTT positioning / region / inline styling is out of MVP scope (aligns with transcripts-excluded). Engine cue objects (`VTTCue`) never reach the public API. Overlay styling is done with CSS variables, not per-cue geometry.
- **Renderer intent** is a controller setting so the provider can show/hide native drawing:
  `controller.setCaptionRenderer(mode: 'custom' | 'native')`. Effective `captionRendering` is computed from intent + provider capability and reported honestly.

### Provider contract additions (all optional — no-caption providers omit)

```ts
// ProviderAdapter
subscribeCues?: (listener: (cues: readonly TextCue[]) => void) => () => void;
setCaptionRenderer?: (mode: 'custom' | 'native') => void;
// textTracks, selectedTextTrackId, captionRendering flow through the existing ProviderStatePatch.
```

Controller re-exposes `subscribeCues` (fans out to whichever provider is attached; emits `[]` when none). `setCaptionRenderer` forwards to the provider and updates the effective mode. Source switch clears tracks, selection, and cues.

## Provider mapping

### `@reely/provider-native`

- Discovery: external `<track>` elements + `HTMLMediaElement.textTracks`. Normalize each to `TextTrack`; derive a stable id (underlying `track.id` when present, else `native:<index>`), map `kind` (`captions`/`subtitles` → keep; others → excluded from the list), `readiness` from track load state.
- **Default selection rule:** if a discovered `captions`/`subtitles` track carries the `default` attribute (native `<track default>` / provider default flag), it is selected on load; otherwise selection starts `off` (`selectedTextTrackId = null`). User selection always overrides and persists until source switch.
- Custom mode: set the underlying track `mode = 'hidden'` (cues fire via `cuechange`, browser draws nothing); emit active cues through `subscribeCues`.
- Native mode: `mode = 'showing'` for the selected track, `disabled` for others; overlay stands down; effective `captionRendering = 'native'`.
- `capabilities.selectTextTrack` flips to `available` once a track list exists.

### `@reely/provider-hls`

- Embedded WebVTT for **both engines**: native Safari (`HTMLMediaElement.textTracks`, same path as native provider) and hls.js (`hlsjs` subtitle tracks + cue events). Normalize to the same `TextTrack` / `TextCue` shapes. Same custom/native mode handling.

## React primitives (`@reely/react`)

### `Player.Captions` — the custom overlay

- Reads effective `captionRendering`; renders **only** when `=== 'custom'`. In `native` / `provider` / `unavailable` it renders nothing → no double rendering by construction.
- Subscribes to active cues via `useActiveCues()`.
- Caption layer at `z-index: 20`, safe-area-aware positioning (`env(safe-area-inset-*)`), user style variables (font size, colors, background, edge style) exposed as CSS custom properties.
- `renderCue?: (cue: TextCue) => ReactNode` render prop for full customization; default renders `text` (multi-line preserved). Engine cue objects never exposed.
- Contract attrs: `data-reely-part="captions"`, `data-state` = `custom` / `off`, no `aria-live`.
- Robustness: malformed / empty cues don't crash the overlay (guarded render).

### `Player.Root` renderer prop

- `captionRenderer?: 'custom' | 'native'` (default `'custom'`), pass-through mirroring `autoplay` / `loading` → calls `controller.setCaptionRenderer`. Single control point.

### Captions button + menu

- Captions toggle/menu built on the #31 `SettingsMenu` primitives (track selection list + Off; `role="menuitemradio"` semantics), `C` keyboard shortcut (respects existing shortcut suppression while a menu is open), captions button reflects on/off via `data-state`.
- **One-time announcement:** on selection change, a small `aria-live="polite"` region (owned by the button/menu, not the overlay) announces "`<label>` captions on" / "Captions off" once. Cue text never announced.

## Testing

- **Core** (`@reely/core`): initial-state fields; `subscribeCues` fan-out / empty when no provider; `setCaptionRenderer` → effective mode; source-switch reset. Failing-first.
- **Provider-native**: external `<track>` discovery, default selection rules, off state, language switching, cue enter/exit timing, source-switch reset, malformed cues, capability changes. Failing-first.
- **Provider-hls**: embedded WebVTT discovery for both engines; cue normalization.
- **React** (`@reely/react`): overlay renders only in custom mode; `renderCue` customization without engine leakage; native mode → overlay empty + effective mode `native`; announcement fires once on selection, cue text never in a live region; safe-area styling present.
- **Stories** (per #19, mock controller): one-line, multi-line, long-text, high-contrast, safe-area cue variants.
- **e2e**: `pnpm test:e2e -- --grep captions` in Chromium and WebKit.
- **Axe**: passes with captions on.

## HITL gates

- **Owner visual review (required):** the cue stories reviewed and approved in Storybook (`verify-storybook-visually` memory: drive real dev server).
- Docs: both rendering modes + **author responsibilities** — caption accuracy, sync, language labeling, and WCAG conformance remain the content author's job; Reely provides the mechanics only.

## Out of scope

YouTube/Vimeo caption integration (next issue — contracts here are what it plugs into), transcripts, WebVTT positioning/region/inline styling.

## Build order (7 slices)

1. Core text-track contracts (types, state, `subscribeCues`, `setCaptionRenderer`, command wiring) + tests.
2. provider-native discovery / selection / cue emission + tests.
3. provider-hls embedded WebVTT (native + hls.js) + tests.
4. `Player.Captions` overlay (renderCue, custom/native gating, z20, safe-area, style vars) + tests.
5. Captions button/menu + one-time announcements + `C` shortcut + tests.
6. Stories + **HITL owner visual review**.
7. Docs + e2e (Chromium/WebKit) + final whole-branch review.

Overlap watch: slices 4–5 share `packages/react` with #9 — do not run #9 concurrently.
