import { expect, test, type Locator, type Page } from '@playwright/test';
import { controls } from './locators';

// happy-dom, the react package's unit-test environment, does not implement
// shadow-DOM event retargeting (a keydown's `event.target` reading back as
// the shadow host once the listener sits outside the shadow tree), so
// nothing in `packages/react/test/controls.test.tsx` can exercise it. This
// file is the real-browser counterpart: it drives the `global-shortcuts`
// story (the same composition `e2e/a11y.spec.ts` already scans for this
// mode) and injects real open shadow roots onto the page around and inside
// it, the way a design-system widget elsewhere on a host page would.
//
// Playwright's own locators pierce an open shadow root for an ordinary CSS
// selector, so every element built below is found the same way a
// non-shadow one is, by a `data-shadow-probe` attribute.
const globalShortcuts =
  '/iframe.html?id=reference-player--global-shortcuts&viewMode=story';

// `Player.Controls` with no `global` prop -- the default, scoped mode -- so
// the shortcut layer listens on the region itself rather than on
// `document`. `composition` is the same story `e2e/a11y.spec.ts` drives for
// this composition's `paused`/`captions-on` states: playing or idle both
// hide the control row behind `ActivationButton`/keep it out of the paint
// order, so this is the one state with a visible, focusable region to plant
// a shadow host in.
const scopedShortcuts =
  '/iframe.html?id=reference-player--composition&viewMode=story';

declare global {
  interface Window {
    __shortcutKeydownLog: Array<{ key: string; defaultPrevented: boolean }>;
  }
}

// Installed only after the story (and so `Controls`' own `document` listener,
// attached on mount) is up: a listener added later runs after one added
// earlier, for the same target and phase, so every entry this pushes already
// reflects whatever `Controls`' handler decided. This is the same signal
// `packages/react/test/controls.test.tsx` reads off `fireEvent.keyDown`'s own
// return value (`!defaultPrevented`) for the identical PageUp/PageDown and
// arrow-key rules — real-browser retargeting is the only reason this file
// exists instead of another unit test.
const recordKeydowns = (page: Page) =>
  page.evaluate(() => {
    window.__shortcutKeydownLog = [];
    document.addEventListener('keydown', (event) => {
      window.__shortcutKeydownLog.push({
        key: event.key,
        defaultPrevented: event.defaultPrevented
      });
    });
  });

const keydownLog = (page: Page) =>
  page.evaluate(() => window.__shortcutKeydownLog);

const lastPrevented = async (page: Page, key: string): Promise<boolean> => {
  const log = await keydownLog(page);
  const entry = [...log].reverse().find((item) => item.key === key);
  if (!entry) throw new Error(`no keydown recorded for ${JSON.stringify(key)}`);
  return entry.defaultPrevented;
};

// Builds a `<div>` shadow host (one of the tag names the DOM spec allows as a
// shadow host with no custom-element registration needed), gives its open
// shadow root the markup a design-system widget would render, and appends it
// to `document.body` (outside the player entirely), inside
// `[data-playdeck-part="viewport"]` (still inside the player's own boundary,
// same as `keyOwnershipBoundary` in `controls.tsx` resolves it), or inside
// `[data-playdeck-part="controls"]` (the region itself, for the scoped-mode
// case below).
const appendShadowHost = (
  page: Page,
  {
    hostRole,
    shadowHtml
  }: { readonly hostRole?: string; readonly shadowHtml: string },
  inside: 'body' | 'viewport' | 'controls'
) =>
  page.evaluate(
    ({ hostRole, shadowHtml, inside }) => {
      const host = document.createElement('div');
      if (hostRole) host.setAttribute('role', hostRole);
      const shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML = shadowHtml;
      const parent =
        inside === 'body'
          ? document.body
          : document.querySelector(`[data-playdeck-part="${inside}"]`);
      if (!parent)
        throw new Error('no parent found to append the shadow host to');
      parent.appendChild(host);
    },
    { hostRole, shadowHtml, inside }
  );

const probe = (page: Page, name: string): Locator =>
  page.locator(`[data-shadow-probe="${name}"]`);

test.describe('shadow-DOM keydown targets in global keyboard mode', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(globalShortcuts);
    await expect(controls(page)).toHaveAttribute('data-state', 'global');
    await recordKeydowns(page);
  });

  test('text entry inside an open shadow root outside the player takes every key', async ({
    page
  }) => {
    await appendShadowHost(
      page,
      {
        shadowHtml:
          '<input type="text" data-shadow-probe="text-input" /><textarea data-shadow-probe="textarea"></textarea>'
      },
      'body'
    );

    const input = probe(page, 'text-input');
    await input.focus();
    await page.keyboard.press('k');
    await expect(input).toHaveValue('k');
    expect(await lastPrevented(page, 'k')).toBe(false);

    const textarea = probe(page, 'textarea');
    await textarea.focus();
    await page.keyboard.press('m');
    await expect(textarea).toHaveValue('m');
    expect(await lastPrevented(page, 'm')).toBe(false);
  });

  test('an arrow key on a role="slider" inside an open shadow root outside the player is left to it', async ({
    page
  }) => {
    await appendShadowHost(
      page,
      {
        shadowHtml:
          '<div role="slider" tabindex="0" aria-valuenow="5" data-shadow-probe="slider"></div>'
      },
      'body'
    );

    await probe(page, 'slider').focus();
    await page.keyboard.press('ArrowRight');
    expect(await lastPrevented(page, 'ArrowRight')).toBe(false);
  });

  test('an arrow key on a role="tablist" inside an open shadow root outside the player is left to it', async ({
    page
  }) => {
    await appendShadowHost(
      page,
      {
        shadowHtml:
          '<div role="tablist" tabindex="0" data-shadow-probe="tablist"></div>'
      },
      'body'
    );

    await probe(page, 'tablist').focus();
    await page.keyboard.press('ArrowLeft');
    expect(await lastPrevented(page, 'ArrowLeft')).toBe(false);
  });

  // The role sits on the shadow HOST -- a light-DOM element, outside the
  // shadow root -- rather than on the focused node itself, the shape the
  // design brief names as a widget that puts an ARIA role on its host while
  // its interactive parts live in the shadow tree. `ownsArrowKeysTarget`
  // answers this through `matchesInPath`, which walks the keydown's composed
  // path instead of calling `closest()` on the originating node directly:
  // `closest()` alone, even once the target itself reads correctly, cannot
  // reach an ancestor that sits on the other side of a shadow boundary.
  //
  // Demonstrated red (docs/agents/demonstrated-red.md), substitute mutation:
  // this exact DOM shape does not fail against the unfixed handler --
  // unfixed `event.target` retargets to the host, and the host itself
  // carries the role, so `closest()` self-matches immediately and the case
  // passes by accident, for a reason this fix does not touch. The assertion
  // this test makes only starts to matter once the target itself is read
  // correctly, so the substitute is `ownsArrowKeysTarget` with
  // `matchesInPath(path, arrowKeyRoleSelector)` reverted to
  // `node.closest(arrowKeyRoleSelector) !== null` (the originating-node fix
  // kept in place everywhere else). Run against that mutation: the focused
  // node is inside the shadow root, `closest()` on it cannot cross out to the
  // host's `role="slider"`, so the exemption is not found and the arrow is
  // captured -- `expect(lastPrevented).toBe(false)` reads `true` instead.
  test('an arrow key is left to a widget whose role sits on its shadow host, outside the player', async ({
    page
  }) => {
    await appendShadowHost(
      page,
      {
        hostRole: 'slider',
        shadowHtml: '<div tabindex="0" data-shadow-probe="thumb"></div>'
      },
      'body'
    );

    await probe(page, 'thumb').focus();
    await page.keyboard.press('ArrowUp');
    expect(await lastPrevented(page, 'ArrowUp')).toBe(false);
  });

  // Guard, not a demonstrated-red case: this direction is not independently
  // at risk from the retargeting bug this file otherwise catches. A shadow
  // host appended outside the player is outside it whether containment is
  // read off the retargeted host (what the unfixed handler reads) or off the
  // true originating node through `isInComposedPath` -- both walk the same
  // light-DOM ancestry once they leave the shadow tree, and a host that
  // never re-enters the player's own subtree cannot look "inside" either
  // way. Confirmed rather than assumed, against both the fully unfixed
  // handler and the `isInComposedPath` substitute mutation recorded on the
  // test below: this one stayed green under each. Kept here for the
  // acceptance criterion's own coverage and as a regression pin.
  test('PageUp and PageDown on a focusable element inside an open shadow root outside the player are left to the page', async ({
    page
  }) => {
    await appendShadowHost(
      page,
      {
        shadowHtml: '<div tabindex="0" data-shadow-probe="page-outside"></div>'
      },
      'body'
    );

    await probe(page, 'page-outside').focus();
    await page.keyboard.press('PageUp');
    expect(await lastPrevented(page, 'PageUp')).toBe(false);
    await page.keyboard.press('PageDown');
    expect(await lastPrevented(page, 'PageDown')).toBe(false);
  });

  // The opposite direction, and the one the retargeting bug actually
  // threatens: `Node.contains` never sees into an attached shadow root (a
  // direct check, above `isInComposedPath` in `controls.tsx`, confirmed
  // `boundary.contains(nodeInsideAnOpenShadowRoot)` false even where
  // `boundary` is the shadow host's own parent), so a widget nested inside
  // the player through an open shadow root needs `isInComposedPath`'s
  // composed-path membership test to still read as inside.
  //
  // Demonstrated red (docs/agents/demonstrated-red.md), substitute mutation:
  // this does not fail against the fully unfixed handler -- `event.target`
  // retargets to the shadow host, which is an ordinary light-DOM child of
  // the boundary, so `boundary.contains(host)` already reads true by the
  // same accident the arrow test above names. The substitute is
  // `isInComposedPath` with `path.includes(boundary)` reverted to
  // `target instanceof Node && boundary.contains(target)`, `target` taken as
  // `path[0]` so the originating-node fix stays in place everywhere else.
  // Run against that mutation: `boundary.contains()` is asked about the true
  // node inside the shadow root rather than its host, finds nothing, and
  // `expect(lastPrevented(page, 'PageUp')).toBe(true)` reads `false` instead
  // -- PageUp left to the page instead of seeking. The sibling "outside"
  // test above was run against the same mutation and stayed green, which is
  // why it carries no red demonstration of its own.
  test('PageUp and PageDown on a focusable element inside an open shadow root within the player boundary seek', async ({
    page
  }) => {
    await appendShadowHost(
      page,
      {
        shadowHtml: '<div tabindex="0" data-shadow-probe="page-inside"></div>'
      },
      'viewport'
    );

    await probe(page, 'page-inside').focus();
    await page.keyboard.press('PageUp');
    expect(await lastPrevented(page, 'PageUp')).toBe(true);
    await page.keyboard.press('PageDown');
    expect(await lastPrevented(page, 'PageDown')).toBe(true);
  });
});

test.describe('shadow-DOM keydown targets in scoped keyboard mode', () => {
  // Scoped mode listens on the region itself rather than on `document`
  // (`onKeyDown={(event) => { ...; if (!global) handleShortcut(event.nativeEvent); }}`
  // in `controls.tsx`), so the originating-node fix has to hold there too --
  // this is the desired behaviour the design brief states for it, not just
  // for `global`. A keydown from inside an open shadow root nested INSIDE
  // the region is exactly the shape `event.target` retargeting affects:
  // React's own delegated listener sees the same retargeted host a plain
  // `document` listener would.
  test.beforeEach(async ({ page }) => {
    await page.goto(scopedShortcuts);
    await expect(controls(page)).toHaveAttribute('data-state', 'scoped');
    await recordKeydowns(page);
  });

  test('text entry inside an open shadow root within the controls region takes every key', async ({
    page
  }) => {
    await appendShadowHost(
      page,
      {
        shadowHtml: '<input type="text" data-shadow-probe="scoped-input" />'
      },
      'controls'
    );

    const input = probe(page, 'scoped-input');
    await input.focus();
    await page.keyboard.press('k');
    await expect(input).toHaveValue('k');
    expect(await lastPrevented(page, 'k')).toBe(false);
  });
});
