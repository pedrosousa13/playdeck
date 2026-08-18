# Control primitives: settings menu, icon set, gestures (#31)

**Issue:** #31 (parent #1). Split from #8. Depends on #8 (styling contract + `Controls`) and #19 (story conventions) — both landed (#47, #40).

## Goal

Add three optional, tree-shakeable primitives on top of #8's locked contract: an accessible `SettingsMenu`, a built-in icon set, and viewport gestures. Every non-core piece is an opt-in named export that tree-shakes out when unused — same model as icons. Nothing here is forced into the required render path; controls keep their text fallbacks.

## Contract inherited from #8 (do not break)

- Stable `data-playdeck-part`, `data-state`, `data-provider` attributes + ARIA state.
- `className` / `style` / `ref` passthrough; `{...props}` spread; replaceable children.
- Shared hit-target: `controlTargetStyle = { minWidth: 44, minHeight: 44 }` (`index.tsx:1160`).
- Menu suppression hooks already exist: `isInOpenMenu` (`index.tsx:1535`) matches `role="menu"` / `data-playdeck-menu="open"`; an open menu already suppresses the keyboard shortcut handler.
- Focus-restore pattern to mirror: `hadFocusWithin` + `gatedSignature` effect (`index.tsx:1587,1692-1698,1715-1729`).
- `package.json` `sideEffects: false`; single `.` export; single-entry build (`vite.config.ts:6`) bundles only `src/index.tsx`.

## 1. Icon set

- New file `packages/react/src/icons.tsx`, re-exported from `index.tsx` via `export * from './icons.js'` so the single-entry build reaches them and they tree-shake.
- Each icon: inline SVG, `viewBox="0 0 24 24"`, `fill`/`stroke` via `currentColor`, sized `1em`, `aria-hidden` default `true` (decorative — controls own their `aria-label`), spreads `props: SVGProps<SVGSVGElement>`, individual named `export const`.
- Set: `PlayIcon`, `PauseIcon`, `VolumeHighIcon`, `VolumeLowIcon`, `MutedIcon`, `FullscreenEnterIcon`, `FullscreenExitIcon`, `PipEnterIcon`, `PipExitIcon`, `SettingsIcon`, `CheckIcon`, `SeekForwardIcon`, `SeekBackwardIcon`, `ReplayIcon`.
- Controls accept these (or custom) as `children`; passing an icon keeps `aria-label` intact (label is independent of children).

## 2. SettingsMenu (compound, hand-rolled, zero-dep)

Optional named exports; unused → tree-shaken.

- `SettingsMenu` — context provider + `position:relative` wrapper. Owns `open` state and focus restoration. `data-playdeck-part="settings-menu-root"`.
- `SettingsMenuTrigger` — `<button>`, `aria-haspopup="menu"`, `aria-expanded`, `aria-controls`, `SettingsIcon` default child, `controlTargetStyle`. Opens on click / Enter / Space / ArrowDown (ArrowDown focuses first item). `data-playdeck-part="settings-menu-trigger"`, `data-state={open?'open':'closed'}`.
- `SettingsMenuContent` — `role="menu"`, `data-playdeck-part="settings-menu"`, `data-playdeck-menu={open?'open':'closed'}` (inherits shortcut suppression). Rendered only while open. Roving focus (ArrowUp/Down wrap, Home/End). **Escape closes → focus returns to trigger** (never `<body>`). Outside pointerdown closes **without** stealing focus. Type-ahead: out of scope (YAGNI).
- `MenuItem` — `role="menuitem"`, roving `tabIndex`, `controlTargetStyle`, `onSelect` closes menu + restores focus to trigger.
- `MenuRadioGroup` (`value`, `onValueChange`) — `role="group"` + context.
- `MenuRadioItem` (`value`, children) — `role="menuitemradio"`, `aria-checked`, renders `CheckIcon` when selected, `controlTargetStyle`. Selecting fires `onValueChange`, closes menu, restores focus.

Focus rule (satisfies AC): on any close path (Escape, select, trigger re-toggle) focus goes to the trigger — predictable, never lost to `<body>`.

## 3. Gestures (headless — #9 owns visibility)

Optional named export `<Player.Gestures>` — full-bleed layer inside `Viewport`, `data-playdeck-part="gestures"`, `position:absolute; inset:0`, z-index below `Controls`/`ActivationButton` and above `Media`/`Poster`.

Props:

- `doubleTapSeek?: boolean = true` — enable double-tap seek.
- `seekOffset?: number = 10` — seconds.
- `onToggleControls?: () => void` — single-tap callback (#9 wires to its visibility store).
- `onSeek?: (direction: 'forward' | 'backward', offset: number) => void` — fired on a double-tap seek (feedback hook).
- `children?` — optional feedback overlay slot.

Behavior:

- Single tap → `onToggleControls()`. **Never** toggles playback. The centered play affordance (`ActivationButton` / a `PlayButton`) stays the only play trigger.
- Double tap (two taps within ~300ms): left half → `controller.seekBy(-seekOffset)`, right half → `controller.seekBy(+seekOffset)`, plus `onSeek(dir, seekOffset)`. `doubleTapSeek={false}` disables the seek only (single-tap toggle still works).
- Single vs double disambiguated with a ~300ms timer (first tap waits to confirm no second tap before firing toggle).
- Taps originating on interactive children (`isNativeActivationTarget`) are ignored, so tapping a control never toggles visibility.

## 4. Tests, stories, docs

Failing-first, semantic assertions only (state attrs / roles, not class names).

- **jsdom** (`packages/react/test/settings-menu.test.tsx`; extend `controls.test.tsx`): open via each opener key; roving focus + Home/End/wrap; Escape closes and focus returns to trigger; outside click closes without stealing focus; `MenuRadioItem` toggles `aria-checked` + fires `onValueChange`. Gestures: single-tap fires `onToggleControls` and does **not** call `togglePlayback`; double-tap left/right calls `seekBy(∓/±offset)` + `onSeek`; `doubleTapSeek={false}` suppresses seek but keeps toggle; taps on a control child are ignored.
- **Icons**: render, `currentColor`, `aria-hidden`, individual named exports resolvable.
- **Bundle** (extend `tests/bundle/native-only`): `main.tsx` imports one icon; `test.mjs` string-searches the entry chunk contents — imported icon present, a known-unused icon's identifier absent from every statically-reachable chunk.
- **Stories** (`apps/storybook/stories/settings-menu.stories.tsx`, gestures story): `Closed` / `Open` / `RadioSelection` states with `play` interaction tests (open → focus first item → Escape → focus trigger; select radio → `aria-checked`), using `withMockPlayer` + `ready()`. Custom-icon docs example (icon as `children` on `PlayButton`).
- All pointer targets (menu items included) ≥ 44×44 via `controlTargetStyle`.

## Verification

```sh
pnpm --filter @playdeck/react test && pnpm --filter @playdeck/bundle-native-only test && pnpm --filter storybook test
```

## Out of scope

Transport primitives + shortcut engine (#8), preset layout / auto-hide / responsive visibility policy (#9 — #31 only emits `onToggleControls`), theme CSS (#10), captions button (captions issue). Menu type-ahead and submenu flyouts (not needed now).
