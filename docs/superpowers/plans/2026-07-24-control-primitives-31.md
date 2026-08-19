# Control Primitives (Settings Menu, Icons, Gestures) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three optional, tree-shakeable primitives to `@playdeck/react` — a built-in icon set, an accessible `SettingsMenu` (with radio option groups), and headless viewport `Gestures` — on top of #8's locked styling/accessibility contract.

**Architecture:** Icons live in a new pure module `packages/react/src/icons.tsx`, re-exported from `index.tsx` so the single-entry build reaches them and they tree-shake (`sideEffects:false`). `SettingsMenu` and `Gestures` are added to `index.tsx` (they need module-local helpers `controlTargetStyle`, `isNativeActivationTarget`, `usePlayer`). All three are opt-in named exports — nothing is forced into the required render path; controls keep their text fallbacks.

**Tech Stack:** React 19, TypeScript, Vite (library build), Vitest + happy-dom (unit), Storybook 8 + `@storybook/addon-vitest` (story tests), Playwright + Vite manifest (bundle harness).

## Global Constraints

- No icon-library dependency — icons are hand-written inline SVG using `currentColor`.
- Every non-core primitive is an individual named `export const` that tree-shakes out when unused (`packages/react/package.json` `sideEffects: false`).
- Icons must be reachable from `packages/react/src/index.tsx` (single-entry build: `packages/react/vite.config.ts:6`).
- Semantic tests only: assert roles, ARIA state, and `data-*` attributes — never implementation class names.
- All pointer targets ≥ 44×44 CSS px via the shared `controlTargetStyle = { minWidth: 44, minHeight: 44 }` (`packages/react/src/index.tsx:1160`).
- Focus is never lost to `<body>`: on every menu close path, focus returns to the trigger.
- Menu content sets `role="menu"` + `data-playdeck-menu="open"` to inherit #8's shortcut suppression (`isInOpenMenu`, `packages/react/src/index.tsx:1535`).
- `data-playdeck-part` naming: kebab-case, matches existing parts.
- Tests are failing-first (TDD): write the test, watch it fail, implement, watch it pass, commit.

---

## Task 1: Icon set

**Files:**
- Create: `packages/react/src/icons.tsx`
- Modify: `packages/react/src/index.tsx` (add one re-export line near the top-level exports)
- Test: `packages/react/test/icons.test.tsx`

**Interfaces:**
- Produces: individual named exports, each `(props: SVGProps<SVGSVGElement>) => ReactElement`:
  `PlayIcon`, `PauseIcon`, `VolumeHighIcon`, `VolumeLowIcon`, `MutedIcon`, `FullscreenEnterIcon`, `FullscreenExitIcon`, `PipEnterIcon`, `PipExitIcon`, `SettingsIcon`, `CheckIcon`, `SeekForwardIcon`, `SeekBackwardIcon`, `ReplayIcon`.
- Each renders `<svg width="1em" height="1em" viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>` so a consumer can override `aria-hidden`/add a label, and inherits text color via `currentColor`.

- [ ] **Step 1: Write the failing test**

Create `packages/react/test/icons.test.tsx`:

```tsx
// @vitest-environment happy-dom

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
import { PlayIcon, CheckIcon, SettingsIcon } from '../src/icons';
import * as Player from '../src/index';

afterEach(cleanup);

describe('icons', () => {
  test('render inline svg with currentColor and are decorative by default', () => {
    const { container } = render(<PlayIcon />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('fill')).toBe('currentColor');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 24 24');
  });

  test('spread props override defaults (e.g. explicit labelling)', () => {
    const { container } = render(
      <CheckIcon aria-hidden={false} role="img" aria-label="Selected" />
    );
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('aria-hidden')).toBeNull();
    expect(svg?.getAttribute('aria-label')).toBe('Selected');
  });

  test('are re-exported from the package entry', () => {
    expect(Player.SettingsIcon).toBe(SettingsIcon);
    expect(Player.PlayIcon).toBe(PlayIcon);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @playdeck/react exec vitest run test/icons.test.tsx`
Expected: FAIL — cannot resolve `../src/icons` / `Player.SettingsIcon` undefined.

- [ ] **Step 3: Create the icons module**

Create `packages/react/src/icons.tsx`:

```tsx
import type { ReactElement, SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

const Icon = (
  { children, ...props }: IconProps & { children: ReactElement | ReactElement[] }
): ReactElement => (
  <svg
    aria-hidden
    fill="currentColor"
    height="1em"
    viewBox="0 0 24 24"
    width="1em"
    {...props}
  >
    {children}
  </svg>
);

export const PlayIcon = (props: IconProps): ReactElement => (
  <Icon {...props}>
    <path d="M8 5v14l11-7z" />
  </Icon>
);

export const PauseIcon = (props: IconProps): ReactElement => (
  <Icon {...props}>
    <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
  </Icon>
);

export const VolumeHighIcon = (props: IconProps): ReactElement => (
  <Icon {...props}>
    <path d="M3 10v4h4l5 4V6L7 10H3zm11-1.5v7a4 4 0 000-7zm0-3.2v2.1a7 7 0 010 12v2.1a9 9 0 000-16.3z" />
  </Icon>
);

export const VolumeLowIcon = (props: IconProps): ReactElement => (
  <Icon {...props}>
    <path d="M3 10v4h4l5 4V6L7 10H3zm11-1.5v7a4 4 0 000-7z" />
  </Icon>
);

export const MutedIcon = (props: IconProps): ReactElement => (
  <Icon {...props}>
    <path d="M3 10v4h4l5 4V6L7 10H3z" />
    <path d="M15 9l6 6m0-6l-6 6" fill="none" stroke="currentColor" strokeWidth="2" />
  </Icon>
);

export const FullscreenEnterIcon = (props: IconProps): ReactElement => (
  <Icon {...props}>
    <path d="M4 9V4h5v2H6v3H4zm11-5h5v5h-2V6h-3V4zM4 15h2v3h3v2H4v-5zm14 0h2v5h-5v-2h3v-3z" />
  </Icon>
);

export const FullscreenExitIcon = (props: IconProps): ReactElement => (
  <Icon {...props}>
    <path d="M7 7V4H5v5h5V7H7zm7-3v5h5V7h-3V4h-2zM5 15h5v5H8v-3H5v-2zm12 0h2v2h-3v3h-2v-5h3z" />
  </Icon>
);

export const PipEnterIcon = (props: IconProps): ReactElement => (
  <Icon {...props}>
    <path d="M3 5h18v14H3V5zm2 2v10h14V7H5zm6 3h6v5h-6v-5z" />
  </Icon>
);

export const PipExitIcon = (props: IconProps): ReactElement => (
  <Icon {...props}>
    <path d="M3 5h18v14H3V5zm2 2v10h14V7H5zm2 2h6v4H7V9z" />
  </Icon>
);

export const SettingsIcon = (props: IconProps): ReactElement => (
  <Icon {...props}>
    <path d="M12 8a4 4 0 100 8 4 4 0 000-8zm0 2a2 2 0 110 4 2 2 0 010-4z" />
    <path d="M10.5 2h3l.5 2.6a7.5 7.5 0 011.7 1l2.5-1 1.5 2.6-2 1.7a7.6 7.6 0 010 2l2 1.7-1.5 2.6-2.5-1a7.5 7.5 0 01-1.7 1L13.5 22h-3l-.5-2.6a7.5 7.5 0 01-1.7-1l-2.5 1L4.3 15.8l2-1.7a7.6 7.6 0 010-2l-2-1.7L5.8 7.8l2.5 1a7.5 7.5 0 011.7-1L10.5 2z" fillRule="evenodd" />
  </Icon>
);

export const CheckIcon = (props: IconProps): ReactElement => (
  <Icon {...props}>
    <path d="M9 16.2l-3.5-3.5L4 14.2 9 19 20 8l-1.4-1.4z" />
  </Icon>
);

export const SeekForwardIcon = (props: IconProps): ReactElement => (
  <Icon {...props}>
    <path d="M4 5l8 7-8 7V5zm9 0l8 7-8 7V5z" />
  </Icon>
);

export const SeekBackwardIcon = (props: IconProps): ReactElement => (
  <Icon {...props}>
    <path d="M20 5l-8 7 8 7V5zm-9 0l-8 7 8 7V5z" />
  </Icon>
);

export const ReplayIcon = (props: IconProps): ReactElement => (
  <Icon {...props}>
    <path d="M12 5V2L7 6l5 4V7a5 5 0 11-5 5H5a7 7 0 107-7z" />
  </Icon>
);
```

- [ ] **Step 4: Re-export from the package entry**

In `packages/react/src/index.tsx`, add this line directly beneath the existing `import { NativePlaybackOptions } ...` / `use-activation` import group near the top (after line 18, before the React import block) is fine, but place the **re-export** with the other top-level exports — add at the very end of the file:

```tsx
export * from './icons.js';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @playdeck/react exec vitest run test/icons.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/icons.tsx packages/react/src/index.tsx packages/react/test/icons.test.tsx
git commit -m "Add built-in inline SVG icon set (#31)"
```

---

## Task 2: Icon tree-shake bundle assertion

**Files:**
- Modify: `tests/bundle/native-only/src/main.tsx` (import + render one icon)
- Modify: `tests/bundle/native-only/test.mjs` (add chunk-content string assertions)

**Interfaces:**
- Consumes: `PlayIcon`, `ReplayIcon` from Task 1.
- Relies on: unique SVG path strings surviving minification as string literals — `PlayIcon` path `M8 5v14l11-7z`; `ReplayIcon` path starts `M12 5V2L7 6`.

- [ ] **Step 1: Inspect the current fixture**

Run: `sed -n '1,40p' tests/bundle/native-only/src/main.tsx && sed -n '1,60p' tests/bundle/native-only/test.mjs`
Note the entry render tree and how `test.mjs` reads `.vite/manifest.json` + the emitted entry chunk file. Confirm the manifest's entry chunk `file` path (the harness already resolves it via `staticClosure`).

- [ ] **Step 2: Add a used icon to the fixture render**

In `tests/bundle/native-only/src/main.tsx`, add `PlayIcon` to the existing `import * as Player from '@playdeck/react'` usage — render it inside the existing `ActivationButton` (or alongside it). Example (adapt to the actual JSX already present):

```tsx
<Player.ActivationButton>
  <Player.PlayIcon /> Play
</Player.ActivationButton>
```

Leave `ReplayIcon` unimported and unrendered.

- [ ] **Step 3: Write the failing bundle assertion**

In `tests/bundle/native-only/test.mjs`, after the existing chunk-graph reads, add (using the same `readFileSync`/`join` the file already imports, and the already-resolved entry chunk file path variable — reuse whatever the file calls it; below assumes `entrySource` is the concatenated static-closure source, add a helper if absent):

```js
// Icon tree-shaking: the imported icon's path ships; an unused icon's path is dropped.
import { readFileSync } from 'node:fs';
// ... within the test body, after the static closure is computed:
const closureSources = [...staticClosure(entryChunk)].map((f) =>
  readFileSync(join(distDir, f), 'utf8')
).join('\n');

assert.ok(
  closureSources.includes('M8 5v14l11-7z'),
  'PlayIcon (used) must be present in the static bundle'
);
assert.ok(
  !closureSources.includes('M12 5V2L7 6'),
  'ReplayIcon (unused) must tree-shake out of the static bundle'
);
```

Adapt `staticClosure`, `entryChunk`, `distDir`, and `join` to the identifiers already defined in `test.mjs` (the mapper confirmed `staticClosure` at `test.mjs:22-32`). Do not duplicate an existing `readFileSync`/`join` import.

- [ ] **Step 4: Run to verify it fails first (before the main.tsx render is built)**

Run: `pnpm --filter @playdeck/bundle-native-only test`
Expected: FAIL on the `ReplayIcon` assertion only if a stray import exists, OR FAIL on `PlayIcon` present until the build picks up the new render. If both assertions already pass, deliberately break by temporarily importing `ReplayIcon` in `main.tsx`, re-run, confirm the unused-shakes-out assertion fails, then remove it — this proves the assertion has teeth.

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @playdeck/bundle-native-only test`
Expected: PASS — `PlayIcon` path present, `ReplayIcon` path absent.

- [ ] **Step 6: Commit**

```bash
git add tests/bundle/native-only/src/main.tsx tests/bundle/native-only/test.mjs
git commit -m "Assert unused icons tree-shake out of the bundle (#31)"
```

---

## Task 3: SettingsMenu — trigger, content, focus, keyboard

**Files:**
- Modify: `packages/react/src/index.tsx` (add `SettingsMenu`, `SettingsMenuTrigger`, `SettingsMenuContent`, `MenuItem`)
- Test: `packages/react/test/settings-menu.test.tsx`

**Interfaces:**
- Consumes: `controlTargetStyle` (`index.tsx:1160`), `isNativeActivationTarget` (`index.tsx:1541`), `SettingsIcon` (Task 1), React `useId`, `createContext`, `useContext`, `useState`, `useRef`, `useEffect`, `useCallback`.
- Produces:
  - `SettingsMenu` — `(props: ComponentPropsWithRef<'div'>) => ReactElement`
  - `SettingsMenuTrigger` — `(props: ComponentPropsWithRef<'button'>) => ReactElement`
  - `SettingsMenuContent` — `(props: ComponentPropsWithRef<'div'>) => ReactElement | null`
  - `MenuItem` — `(props: ComponentPropsWithRef<'button'> & { onSelect?: () => void }) => ReactElement`
  - Internal context `SettingsMenuContext` with `{ open, setOpen, close, triggerRef, rootRef, triggerId, contentId }` where `close()` sets open false and refocuses the trigger.

- [ ] **Step 1: Write the failing test**

Create `packages/react/test/settings-menu.test.tsx`:

```tsx
// @vitest-environment happy-dom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
import * as Player from '../src/index';

afterEach(cleanup);

const Menu = () => (
  <Player.SettingsMenu>
    <Player.SettingsMenuTrigger />
    <Player.SettingsMenuContent>
      <Player.MenuItem>Quality</Player.MenuItem>
      <Player.MenuItem>Speed</Player.MenuItem>
    </Player.SettingsMenuContent>
  </Player.SettingsMenu>
);

const attr = (el: Element | null, n: string) => el?.getAttribute(n) ?? null;

describe('SettingsMenu', () => {
  test('trigger is a labelled button that is closed by default', () => {
    render(<Menu />);
    const trigger = screen.getByRole('button', { name: 'Settings' });
    expect(attr(trigger, 'aria-haspopup')).toBe('menu');
    expect(attr(trigger, 'aria-expanded')).toBe('false');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  test('clicking the trigger opens the menu and moves focus to the first item', async () => {
    render(<Menu />);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    const menu = screen.getByRole('menu');
    expect(attr(menu, 'data-playdeck-menu')).toBe('open');
    expect(attr(menu, 'data-playdeck-part')).toBe('settings-menu');
    await waitFor(() =>
      expect(screen.getAllByRole('menuitem')[0]).toHaveFocus()
    );
  });

  test('arrow keys move roving focus and wrap', async () => {
    render(<Menu />);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    const items = screen.getAllByRole('menuitem');
    await waitFor(() => expect(items[0]).toHaveFocus());
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });
    expect(items[1]).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });
    expect(items[0]).toHaveFocus(); // wraps
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'End' });
    expect(items[1]).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Home' });
    expect(items[0]).toHaveFocus();
  });

  test('Escape closes the menu and returns focus to the trigger', async () => {
    render(<Menu />);
    const trigger = screen.getByRole('button', { name: 'Settings' });
    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByRole('menu')).toBeTruthy());
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).toHaveFocus();
    expect(attr(trigger, 'aria-expanded')).toBe('false');
  });

  test('selecting an item fires onSelect, closes, and restores focus to trigger', async () => {
    let picked = '';
    render(
      <Player.SettingsMenu>
        <Player.SettingsMenuTrigger />
        <Player.SettingsMenuContent>
          <Player.MenuItem onSelect={() => (picked = 'quality')}>
            Quality
          </Player.MenuItem>
        </Player.SettingsMenuContent>
      </Player.SettingsMenu>
    );
    const trigger = screen.getByRole('button', { name: 'Settings' });
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Quality' }));
    expect(picked).toBe('quality');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).toHaveFocus();
  });

  test('outside pointerdown closes the menu without stealing focus', async () => {
    render(
      <div>
        <button type="button">outside</button>
        <Menu />
      </div>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    await waitFor(() => expect(screen.getByRole('menu')).toBeTruthy());
    fireEvent.pointerDown(screen.getByRole('button', { name: 'outside' }));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  test('menu items meet the 44px hit target', async () => {
    render(<Menu />);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    const item = (await screen.findAllByRole('menuitem'))[0];
    expect(item.style.minWidth).toBe('44px');
    expect(item.style.minHeight).toBe('44px');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @playdeck/react exec vitest run test/settings-menu.test.tsx`
Expected: FAIL — `Player.SettingsMenu` etc. undefined.

- [ ] **Step 3: Add `useId` to the React import**

In `packages/react/src/index.tsx`, add `useId` to the existing `react` import block (the one containing `useCallback`, `useContext`, ... `useState`).

- [ ] **Step 4: Implement the menu components**

Add near the end of `packages/react/src/index.tsx` (after `Controls`, before the `export * from './icons.js';` line). Import `SettingsIcon` is already available via the same module once Task 1's re-export exists, but reference it directly — add `SettingsIcon` to a local import from `./icons.js` at the top **only if** it is not yet in scope; simplest is to import it: add `import { SettingsIcon } from './icons.js';` to the top import group.

```tsx
type SettingsMenuContextValue = {
  readonly open: boolean;
  readonly setOpen: (open: boolean) => void;
  readonly close: () => void;
  readonly triggerRef: React.RefObject<HTMLButtonElement | null>;
  readonly rootRef: React.RefObject<HTMLDivElement | null>;
  readonly triggerId: string;
  readonly contentId: string;
};

const SettingsMenuContext = createContext<SettingsMenuContextValue | null>(null);

const useSettingsMenu = (): SettingsMenuContextValue => {
  const ctx = useContext(SettingsMenuContext);
  if (!ctx) {
    throw new Error('SettingsMenu components must be used within <SettingsMenu>');
  }
  return ctx;
};

const menuItems = (root: HTMLElement | null): HTMLElement[] =>
  root
    ? Array.from(
        root.querySelectorAll<HTMLElement>(
          '[role="menuitem"], [role="menuitemradio"]'
        )
      )
    : [];

export const SettingsMenu = ({
  children,
  style,
  ...props
}: ComponentPropsWithRef<'div'>) => {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const baseId = useId();
  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);
  const value: SettingsMenuContextValue = {
    open,
    setOpen,
    close,
    triggerRef,
    rootRef,
    triggerId: `${baseId}-trigger`,
    contentId: `${baseId}-content`
  };
  return (
    <SettingsMenuContext.Provider value={value}>
      <div
        {...props}
        data-playdeck-part="settings-menu-root"
        data-state={open ? 'open' : 'closed'}
        ref={rootRef}
        style={{ position: 'relative', ...style }}
      >
        {children}
      </div>
    </SettingsMenuContext.Provider>
  );
};

export const SettingsMenuTrigger = ({
  children,
  onClick,
  onKeyDown,
  style,
  ...props
}: ComponentPropsWithRef<'button'>) => {
  const { open, setOpen, triggerRef, triggerId, contentId } = useSettingsMenu();
  return (
    <button
      {...props}
      aria-controls={open ? contentId : undefined}
      aria-expanded={open}
      aria-haspopup="menu"
      aria-label={props['aria-label'] ?? 'Settings'}
      data-playdeck-part="settings-menu-trigger"
      data-state={open ? 'open' : 'closed'}
      id={triggerId}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        setOpen(!open);
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented) return;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          setOpen(true); // Content autofocuses its first item on open
        }
      }}
      ref={triggerRef}
      style={{ ...controlTargetStyle, ...style }}
      type="button"
    >
      {children ?? <SettingsIcon />}
    </button>
  );
};

export const SettingsMenuContent = ({
  children,
  onKeyDown,
  style,
  ...props
}: ComponentPropsWithRef<'div'>) => {
  const { open, close, setOpen, rootRef, triggerId, contentId } =
    useSettingsMenu();
  const contentRef = useRef<HTMLDivElement | null>(null);

  // Autofocus the first item when the menu opens.
  useEffect(() => {
    if (!open) return;
    menuItems(contentRef.current)[0]?.focus();
  }, [open]);

  // Close on outside pointerdown without stealing focus.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node | null;
      if (target && rootRef.current && !rootRef.current.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, rootRef, setOpen]);

  if (!open) return null;

  const move = (delta: number): void => {
    const items = menuItems(contentRef.current);
    if (items.length === 0) return;
    const current = items.findIndex((el) => el === document.activeElement);
    const next = (current + delta + items.length) % items.length;
    items[next]?.focus();
  };

  return (
    <div
      {...props}
      aria-labelledby={triggerId}
      data-playdeck-menu="open"
      data-playdeck-part="settings-menu"
      id={contentId}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented) return;
        switch (event.key) {
          case 'Escape':
            event.preventDefault();
            close();
            return;
          case 'ArrowDown':
            event.preventDefault();
            move(1);
            return;
          case 'ArrowUp':
            event.preventDefault();
            move(-1);
            return;
          case 'Home': {
            event.preventDefault();
            menuItems(contentRef.current)[0]?.focus();
            return;
          }
          case 'End': {
            event.preventDefault();
            const items = menuItems(contentRef.current);
            items[items.length - 1]?.focus();
            return;
          }
          case 'Tab':
            setOpen(false); // let focus leave naturally
            return;
          default:
            return;
        }
      }}
      ref={contentRef}
      role="menu"
      style={style}
    >
      {children}
    </div>
  );
};

export const MenuItem = ({
  children,
  onClick,
  onSelect,
  style,
  ...props
}: ComponentPropsWithRef<'button'> & { readonly onSelect?: () => void }) => {
  const { close } = useSettingsMenu();
  return (
    <button
      {...props}
      data-playdeck-part="menu-item"
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        onSelect?.();
        close();
      }}
      role="menuitem"
      style={{ ...controlTargetStyle, ...style }}
      tabIndex={-1}
      type="button"
    >
      {children}
    </button>
  );
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @playdeck/react exec vitest run test/settings-menu.test.tsx`
Expected: PASS (7 tests).

- [ ] **Step 6: Run the full react suite to check no regression**

Run: `pnpm --filter @playdeck/react test`
Expected: PASS (existing `controls.test.tsx` menu-suppression tests still green).

- [ ] **Step 7: Commit**

```bash
git add packages/react/src/index.tsx packages/react/test/settings-menu.test.tsx
git commit -m "Add accessible SettingsMenu primitive with focus restoration (#31)"
```

---

## Task 4: Menu radio groups (single-select options)

**Files:**
- Modify: `packages/react/src/index.tsx` (add `MenuRadioGroup`, `MenuRadioItem`)
- Test: `packages/react/test/settings-menu.test.tsx` (add a `describe` block)

**Interfaces:**
- Consumes: `SettingsMenuContext`/`useSettingsMenu` + `close` (Task 3), `controlTargetStyle`, `CheckIcon` (Task 1).
- Produces:
  - `MenuRadioGroup` — `(props: { value: string; onValueChange: (value: string) => void; children: ReactNode } & ComponentPropsWithRef<'div'>) => ReactElement` — provides a radio context.
  - `MenuRadioItem` — `(props: { value: string } & ComponentPropsWithRef<'button'>) => ReactElement` — `role="menuitemradio"`, `aria-checked`, renders `CheckIcon` when selected.

- [ ] **Step 1: Write the failing test**

Append to `packages/react/test/settings-menu.test.tsx`:

```tsx
describe('MenuRadioGroup', () => {
  const SpeedMenu = ({
    value,
    onValueChange
  }: {
    value: string;
    onValueChange: (v: string) => void;
  }) => (
    <Player.SettingsMenu>
      <Player.SettingsMenuTrigger />
      <Player.SettingsMenuContent>
        <Player.MenuRadioGroup value={value} onValueChange={onValueChange}>
          <Player.MenuRadioItem value="0.5">0.5×</Player.MenuRadioItem>
          <Player.MenuRadioItem value="1">1×</Player.MenuRadioItem>
          <Player.MenuRadioItem value="2">2×</Player.MenuRadioItem>
        </Player.MenuRadioGroup>
      </Player.SettingsMenuContent>
    </Player.SettingsMenu>
  );

  test('marks the selected item and exposes menuitemradio semantics', () => {
    render(<SpeedMenu value="1" onValueChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    const selected = screen.getByRole('menuitemradio', { name: '1×' });
    expect(selected.getAttribute('aria-checked')).toBe('true');
    expect(
      screen.getByRole('menuitemradio', { name: '0.5×' }).getAttribute('aria-checked')
    ).toBe('false');
  });

  test('selecting a radio item fires onValueChange with its value and closes', async () => {
    let value = '1';
    const onChange = (v: string) => (value = v);
    const { rerender } = render(
      <SpeedMenu value={value} onValueChange={onChange} />
    );
    const trigger = screen.getByRole('button', { name: 'Settings' });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitemradio', { name: '2×' }));
    expect(value).toBe('2');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).toHaveFocus();
    rerender(<SpeedMenu value={value} onValueChange={onChange} />);
    fireEvent.click(trigger);
    expect(
      screen.getByRole('menuitemradio', { name: '2×' }).getAttribute('aria-checked')
    ).toBe('true');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @playdeck/react exec vitest run test/settings-menu.test.tsx -t MenuRadioGroup`
Expected: FAIL — `Player.MenuRadioGroup` undefined.

- [ ] **Step 3: Implement radio group + item**

Add to `packages/react/src/index.tsx` directly after `MenuItem`. Add `import { CheckIcon } from './icons.js';` to the top import group (or extend the existing `./icons.js` import from Task 3 to `import { SettingsIcon, CheckIcon } from './icons.js';`).

```tsx
type MenuRadioContextValue = {
  readonly value: string;
  readonly onValueChange: (value: string) => void;
};

const MenuRadioContext = createContext<MenuRadioContextValue | null>(null);

const useMenuRadio = (): MenuRadioContextValue => {
  const ctx = useContext(MenuRadioContext);
  if (!ctx) {
    throw new Error('MenuRadioItem must be used within <MenuRadioGroup>');
  }
  return ctx;
};

export const MenuRadioGroup = ({
  value,
  onValueChange,
  children,
  ...props
}: ComponentPropsWithRef<'div'> & {
  readonly value: string;
  readonly onValueChange: (value: string) => void;
}) => (
  <MenuRadioContext.Provider value={{ value, onValueChange }}>
    <div {...props} data-playdeck-part="menu-radio-group" role="group">
      {children}
    </div>
  </MenuRadioContext.Provider>
);

export const MenuRadioItem = ({
  value,
  children,
  onClick,
  style,
  ...props
}: ComponentPropsWithRef<'button'> & { readonly value: string }) => {
  const { value: selected, onValueChange } = useMenuRadio();
  const { close } = useSettingsMenu();
  const checked = selected === value;
  return (
    <button
      {...props}
      aria-checked={checked}
      data-playdeck-part="menu-radio-item"
      data-state={checked ? 'checked' : 'unchecked'}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        onValueChange(value);
        close();
      }}
      role="menuitemradio"
      style={{ ...controlTargetStyle, ...style }}
      tabIndex={-1}
      type="button"
    >
      <span aria-hidden data-playdeck-part="menu-radio-indicator">
        {checked ? <CheckIcon /> : null}
      </span>
      {children}
    </button>
  );
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @playdeck/react exec vitest run test/settings-menu.test.tsx`
Expected: PASS (all menu tests including the two new radio tests).

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/index.tsx packages/react/test/settings-menu.test.tsx
git commit -m "Add MenuRadioGroup/MenuRadioItem single-select options (#31)"
```

---

## Task 5: Gestures (headless viewport tap + double-tap seek)

**Files:**
- Modify: `packages/react/src/index.tsx` (add `Gestures`)
- Test: `packages/react/test/gestures.test.tsx`

**Interfaces:**
- Consumes: `usePlayer` (`index.tsx:160`) for `controller`, `isNativeActivationTarget` (`index.tsx:1541`).
- Produces: `Gestures` — `(props) => ReactElement` where props are:
  ```ts
  ComponentPropsWithRef<'div'> & {
    readonly doubleTapSeek?: boolean;   // default true
    readonly seekOffset?: number;       // default 10
    readonly onToggleControls?: () => void;
    readonly onSeek?: (direction: 'forward' | 'backward', offset: number) => void;
    readonly doubleTapWindowMs?: number; // default 300 — test seam
  }
  ```
- Behavior: single tap → `onToggleControls()` (never toggles playback); double tap within window → left half `controller.seekBy(-seekOffset)` + `onSeek('backward', offset)`, right half `controller.seekBy(+seekOffset)` + `onSeek('forward', offset)`; `doubleTapSeek={false}` disables the seek branch only; taps whose target is an interactive control (`isNativeActivationTarget`) are ignored.

- [ ] **Step 1: Write the failing test**

Create `packages/react/test/gestures.test.tsx`:

```tsx
// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  type Availability,
  type CommandResult,
  PlayerController,
  type ProviderAdapter,
  type ProviderStateListener,
  type ProviderStatePatch
} from '@playdeck/core';
import * as Player from '../src/index';

const ok = async (): Promise<CommandResult> => ({ ok: true });

const createMockAdapter = () => {
  const listeners = new Set<ProviderStateListener>();
  const spies = {
    play: vi.fn(ok),
    pause: vi.fn(ok),
    seekTo: vi.fn(ok),
    seekBy: vi.fn(ok),
    mute: vi.fn(ok),
    unmute: vi.fn(ok),
    setVolume: vi.fn(ok),
    requestFullscreen: vi.fn(ok),
    exitFullscreen: vi.fn(ok),
    requestPictureInPicture: vi.fn(ok),
    exitPictureInPicture: vi.fn(ok)
  };
  const adapter: ProviderAdapter = {
    provider: 'native',
    attach: () => {},
    load: () => {},
    destroy: () => {},
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    ...spies
  };
  return {
    adapter,
    spies,
    emit: (patch: ProviderStatePatch) => listeners.forEach((l) => l(patch))
  };
};

const renderGestures = (ui: React.ReactNode) => {
  const handle = createRef<Player.PlayerHandle>();
  const utils = render(
    <Player.Root loading="interaction" ref={handle} source="/tracer.mp4">
      {ui}
    </Player.Root>
  );
  const controller = handle.current as unknown as PlayerController;
  const mock = createMockAdapter();
  act(() => {
    controller.setProvider(mock.adapter);
    mock.emit({ lifecycle: 'ready', activation: 'ready', provider: 'native' });
  });
  return { ...utils, spies: mock.spies };
};

// Fire a tap at a given clientX by dispatching pointerup on the gesture layer.
const tapAt = (layer: Element, clientX: number) => {
  // width is mocked to 200 below; left half < 100, right half >= 100.
  Object.defineProperty(layer, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ left: 0, width: 200, right: 200, top: 0, height: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}) })
  });
  fireEvent.pointerUp(layer, { clientX, clientY: 10 });
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  cleanup();
  vi.restoreAllMocks();
});

const getLayer = () =>
  document.querySelector('[data-playdeck-part="gestures"]') as HTMLElement;

describe('Gestures', () => {
  test('single tap toggles controls and never toggles playback', () => {
    const onToggle = vi.fn();
    const { spies } = renderGestures(
      <Player.Viewport>
        <Player.Gestures onToggleControls={onToggle} />
      </Player.Viewport>
    );
    tapAt(getLayer(), 150);
    act(() => vi.advanceTimersByTime(320)); // past the double-tap window
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(spies.play).not.toHaveBeenCalled();
    expect(spies.pause).not.toHaveBeenCalled();
    expect(spies.seekBy).not.toHaveBeenCalled();
  });

  test('double tap on the right half seeks forward by the offset', () => {
    const onSeek = vi.fn();
    const { spies } = renderGestures(
      <Player.Viewport>
        <Player.Gestures onSeek={onSeek} seekOffset={10} />
      </Player.Viewport>
    );
    const layer = getLayer();
    tapAt(layer, 150);
    tapAt(layer, 150);
    expect(spies.seekBy).toHaveBeenCalledWith(10);
    expect(onSeek).toHaveBeenCalledWith('forward', 10);
  });

  test('double tap on the left half seeks backward', () => {
    const { spies } = renderGestures(
      <Player.Viewport>
        <Player.Gestures seekOffset={10} />
      </Player.Viewport>
    );
    const layer = getLayer();
    tapAt(layer, 40);
    tapAt(layer, 40);
    expect(spies.seekBy).toHaveBeenCalledWith(-10);
  });

  test('doubleTapSeek={false} disables seek but keeps the single-tap toggle', () => {
    const onToggle = vi.fn();
    const { spies } = renderGestures(
      <Player.Viewport>
        <Player.Gestures doubleTapSeek={false} onToggleControls={onToggle} />
      </Player.Viewport>
    );
    const layer = getLayer();
    tapAt(layer, 150);
    tapAt(layer, 150);
    act(() => vi.advanceTimersByTime(320));
    expect(spies.seekBy).not.toHaveBeenCalled();
    expect(onToggle).toHaveBeenCalled();
  });

  test('taps on interactive children are ignored', () => {
    const onToggle = vi.fn();
    renderGestures(
      <Player.Viewport>
        <Player.Gestures onToggleControls={onToggle}>
          <button type="button">child</button>
        </Player.Gestures>
      </Player.Viewport>
    );
    fireEvent.pointerUp(screen.getByRole('button', { name: 'child' }), {
      clientX: 10,
      clientY: 10
    });
    act(() => vi.advanceTimersByTime(320));
    expect(onToggle).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @playdeck/react exec vitest run test/gestures.test.tsx`
Expected: FAIL — `Player.Gestures` undefined.

- [ ] **Step 3: Implement `Gestures`**

Add to `packages/react/src/index.tsx` after the menu components (before `export * from './icons.js';`):

```tsx
export type GesturesProps = ComponentPropsWithRef<'div'> & {
  readonly doubleTapSeek?: boolean;
  readonly seekOffset?: number;
  readonly onToggleControls?: () => void;
  readonly onSeek?: (direction: 'forward' | 'backward', offset: number) => void;
  readonly doubleTapWindowMs?: number;
};

export const Gestures = ({
  doubleTapSeek = true,
  seekOffset = 10,
  onToggleControls,
  onSeek,
  doubleTapWindowMs = 300,
  children,
  onPointerUp,
  style,
  ...props
}: GesturesProps) => {
  const { controller } = usePlayer();
  const layerRef = useRef<HTMLDivElement | null>(null);
  const pendingTap = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPending = (): void => {
    if (pendingTap.current !== null) {
      clearTimeout(pendingTap.current);
      pendingTap.current = null;
    }
  };

  useEffect(() => clearPending, []);

  return (
    <div
      {...props}
      data-playdeck-part="gestures"
      onPointerUp={(event) => {
        onPointerUp?.(event);
        if (event.defaultPrevented) return;
        // Ignore taps that land on a real control inside the layer.
        if (isNativeActivationTarget(event.target)) return;

        if (pendingTap.current !== null) {
          // Second tap within the window → double tap.
          clearPending();
          if (!doubleTapSeek) return;
          const node = layerRef.current;
          if (!node) return;
          const rect = node.getBoundingClientRect();
          const forward = event.clientX - rect.left >= rect.width / 2;
          void controller.seekBy(forward ? seekOffset : -seekOffset);
          onSeek?.(forward ? 'forward' : 'backward', seekOffset);
          return;
        }
        // First tap → wait to see if a second arrives.
        pendingTap.current = setTimeout(() => {
          pendingTap.current = null;
          onToggleControls?.();
        }, doubleTapWindowMs);
      }}
      ref={layerRef}
      style={{ position: 'absolute', inset: 0, ...style }}
    >
      {children}
    </div>
  );
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @playdeck/react exec vitest run test/gestures.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/index.tsx packages/react/test/gestures.test.tsx
git commit -m "Add headless Gestures: tap toggles controls, double-tap seeks (#31)"
```

---

## Task 6: Stories + custom-icon docs

**Files:**
- Create: `apps/storybook/stories/settings-menu.stories.tsx`
- Create: `apps/storybook/stories/gestures.stories.tsx`
- Test: the stories' own `play` functions (run under `@storybook/addon-vitest`)

**Interfaces:**
- Consumes: `withMockPlayer` decorator (auto-applied via `.storybook/preview`), `ready`/`available` from `./support`, all Task 1–5 exports.

- [ ] **Step 1: Read the story conventions**

Run: `sed -n '1,110p' apps/storybook/stories/fullscreen-button.stories.tsx && sed -n '1,50p' apps/storybook/stories/support.ts`
Confirm the `meta` shape (`title`, `component`, docs description, `render`), `parameters: ready(...)`, and the `play` signature `async ({ canvas, userEvent })` using `expect` from `storybook/test`.

- [ ] **Step 2: Write the SettingsMenu stories with interaction tests**

Create `apps/storybook/stories/settings-menu.stories.tsx`:

```tsx
import * as Player from '@playdeck/react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { available, ready } from './support';

const menuStyle = {
  position: 'absolute' as const,
  bottom: '3rem',
  right: '0.5rem',
  minWidth: 180,
  padding: '0.25rem',
  background: '#11151c',
  color: '#e8edf4',
  border: '1px solid #2a2f3a',
  borderRadius: 8,
  display: 'flex',
  flexDirection: 'column' as const,
  fontFamily: 'system-ui, sans-serif'
};

const SpeedMenu = () => {
  return (
    <Player.SettingsMenu>
      <Player.SettingsMenuTrigger
        style={{ color: '#e8edf4', background: 'transparent', border: 'none' }}
      />
      <Player.SettingsMenuContent style={menuStyle}>
        <Player.MenuRadioGroup value="1" onValueChange={() => {}}>
          <Player.MenuRadioItem value="0.5">0.5×</Player.MenuRadioItem>
          <Player.MenuRadioItem value="1">1×</Player.MenuRadioItem>
          <Player.MenuRadioItem value="2">2×</Player.MenuRadioItem>
        </Player.MenuRadioGroup>
      </Player.SettingsMenuContent>
    </Player.SettingsMenu>
  );
};

const meta = {
  title: 'Player/SettingsMenu',
  component: Player.SettingsMenu,
  parameters: {
    docs: {
      description: {
        component: [
          '`Player.SettingsMenu` is an accessible menu primitive. The trigger sets `aria-haspopup="menu"`; the content is `role="menu"` with `data-playdeck-menu="open"`, which suppresses the player keyboard shortcuts while open.',
          '',
          '**Focus** — opening moves focus to the first item; Escape, selecting an item, or re-toggling returns focus to the trigger (never `<body>`).',
          '',
          '**Options** — `Player.MenuRadioGroup` + `Player.MenuRadioItem` give single-select semantics (`role="menuitemradio"`, `aria-checked`).'
        ].join('\n')
      }
    }
  },
  render: () => (
    <Player.Viewport style={{ width: 640, height: 360, background: '#0b0e13', position: 'relative' }}>
      <SpeedMenu />
    </Player.Viewport>
  )
} satisfies Meta<typeof Player.SettingsMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

const capable = ready({
  seek: available,
  setVolume: available,
  fullscreen: available,
  pictureInPicture: available
});

export const Closed: Story = { parameters: capable };

export const Open: Story = {
  parameters: capable,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole('button', { name: 'Settings' });
    await userEvent.click(trigger);
    const menu = canvas.getByRole('menu');
    await expect(menu).toHaveAttribute('data-playdeck-menu', 'open');
    const first = canvas.getAllByRole('menuitemradio')[0];
    await expect(first).toHaveFocus();
  }
};

export const EscapeRestoresFocus: Story = {
  parameters: capable,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole('button', { name: 'Settings' });
    await userEvent.click(trigger);
    await expect(canvas.getByRole('menu')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await expect(canvas.queryByRole('menu')).toBeNull();
    await expect(trigger).toHaveFocus();
  }
};

export const SelectingOptionChecksIt: Story = {
  parameters: capable,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Settings' }));
    await userEvent.click(canvas.getByRole('menuitemradio', { name: '2×' }));
    // menu closed after select; reopen and assert the selection persisted is
    // out of scope here (value is uncontrolled in this static story), so just
    // assert the menu closed and focus returned.
    await expect(canvas.queryByRole('menu')).toBeNull();
    await expect(
      canvas.getByRole('button', { name: 'Settings' })
    ).toHaveFocus();
  }
};
```

- [ ] **Step 3: Write the Gestures story with a custom-icon example**

Create `apps/storybook/stories/gestures.stories.tsx`:

```tsx
import * as Player from '@playdeck/react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { available, ready } from './support';

const meta = {
  title: 'Player/Gestures',
  component: Player.Gestures,
  parameters: {
    docs: {
      description: {
        component: [
          '`Player.Gestures` is a headless viewport layer. A single tap fires `onToggleControls` (it never toggles playback); a double-tap seeks ±`seekOffset` seconds — left half back, right half forward — and can be disabled with `doubleTapSeek={false}`.',
          '',
          '**Custom icons** — every control accepts a built-in icon (or your own) as `children`; the built-ins are inline SVG using `currentColor` and are individually tree-shakeable:',
          '```tsx',
          '<Player.PlayButton><Player.PlayIcon /></Player.PlayButton>',
          '<Player.FullscreenButton><Player.FullscreenEnterIcon /></Player.FullscreenButton>',
          '```'
        ].join('\n')
      }
    }
  },
  render: () => (
    <Player.Viewport style={{ width: 640, height: 360, background: '#0b0e13', position: 'relative' }}>
      <Player.Gestures onToggleControls={() => {}} />
      <Player.Controls
        aria-label="Video player controls"
        style={{ position: 'absolute', bottom: 0, left: 0, right: 0, display: 'flex', gap: '0.5rem', padding: '0.5rem', color: '#e8edf4' }}
      >
        <Player.PlayButton><Player.PlayIcon /></Player.PlayButton>
        <Player.MuteButton><Player.VolumeHighIcon /></Player.MuteButton>
        <Player.FullscreenButton><Player.FullscreenEnterIcon /></Player.FullscreenButton>
      </Player.Controls>
    </Player.Viewport>
  )
} satisfies Meta<typeof Player.Gestures>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithCustomIcons: Story = {
  parameters: ready({
    seek: available,
    setVolume: available,
    fullscreen: available,
    pictureInPicture: available
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // The play button renders an inline svg (custom icon) yet keeps its label.
    const play = canvas.getByRole('button', { name: 'Play' });
    await expect(play.querySelector('svg')).not.toBeNull();
    await userEvent.click(play);
  }
};
```

- [ ] **Step 4: Run the story tests**

Run: `pnpm --filter storybook test`
Expected: PASS — all new stories' `play` functions green (and existing stories unaffected). If the storybook workspace filter name differs, run `pnpm test:e2e` per the issue's verification, or check `apps/storybook/package.json` `name` and use it.

- [ ] **Step 5: Commit**

```bash
git add apps/storybook/stories/settings-menu.stories.tsx apps/storybook/stories/gestures.stories.tsx
git commit -m "Add SettingsMenu + Gestures stories with custom-icon docs (#31)"
```

---

## Task 7: Full verification + typecheck/lint

**Files:** none (verification only)

- [ ] **Step 1: Typecheck + lint the package**

Run: `pnpm --filter @playdeck/react typecheck && pnpm --filter @playdeck/react lint`
Expected: PASS. Fix any `import` ordering / `readonly` / exhaustive-deps issues surfaced (the repo lints strictly).

- [ ] **Step 2: Full react unit suite**

Run: `pnpm --filter @playdeck/react test`
Expected: PASS — icons, settings-menu, gestures, and pre-existing suites all green.

- [ ] **Step 3: Bundle tree-shake harness**

Run: `pnpm --filter @playdeck/bundle-native-only test`
Expected: PASS — used icon present, unused icon path absent.

- [ ] **Step 4: Story tests**

Run: `pnpm --filter storybook test`
Expected: PASS.

- [ ] **Step 5: Commit any lint fixes (if made)**

```bash
git add -A
git commit -m "Satisfy typecheck/lint for control primitives (#31)"
```

---

## Self-Review (completed by plan author)

**Spec coverage:**
- Icon set (inline SVG, currentColor, named exports, tree-shake) → Tasks 1, 2. ✓
- SettingsMenu (accessible, focus not lost to body, Escape/select restore) → Task 3. ✓
- Menu radio option groups (menu + radio items, per design decision) → Task 4. ✓
- Double-tap seek (±offset, removable) + viewport tap toggles controls not playback → Task 5. ✓
- 44×44 targets incl. menu items → asserted in Task 3 Step 1 + `controlTargetStyle` on all buttons. ✓
- Stories with play interaction tests + custom-icon docs → Task 6. ✓
- Verification command → Task 7. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. The bundle step (Task 2) instructs adapting to existing `test.mjs` identifiers because those are established by #37/#46 and must not be blindly overwritten — the concrete assertion code is given.

**Type consistency:** `close()` (Task 3) is reused by `MenuItem`, `MenuRadioItem` (Task 4). `SettingsMenuContext`/`useSettingsMenu`, `MenuRadioContext`/`useMenuRadio` names consistent across tasks. `seekOffset`/`doubleTapSeek`/`onToggleControls`/`onSeek` prop names identical between the Gestures interface block, test, and implementation.
