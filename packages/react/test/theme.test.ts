// @vitest-environment node
// Reads files off disk rather than rendering anything, and happy-dom's global
// `URL` cannot resolve `import.meta.url` into a file path.

import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import { describe, expect, test } from 'vitest';
// The WCAG maths lives in one module because `e2e/thumb-contrast.spec.ts`
// measures the same boundaries from rendered pixels (#190), and the two answers
// only mean anything side by side if the formula behind them is literally the
// same one.
import { contrast, over, parseColor } from './contrast';

/**
 * One stylesheet the file-shaped suite below runs against, with the inventory
 * that suite freezes for it. The expectations are per file rather than shared
 * because each stylesheet draws its own set of parts: two themes can reach the
 * same contract through different CSS, and a shared inventory would have to be
 * the union, which is a subset check for both of them.
 */
type StylesheetFixture = {
  readonly label: string;
  readonly source: string;
  readonly exportPath: string;
  readonly expected: {
    readonly atRules: readonly string[];
    readonly pseudoFunctions: readonly string[];
    readonly pseudoElements: readonly string[];
    readonly functions: readonly string[];
    // The needle list `leaves every hand-drawn slider rule out of
    // forced-colors mode` checks for, inside and outside the
    // `(forced-colors: none)` query. Per file because a stylesheet that
    // declares a forced-colors rule for a different set of parts needs a
    // different needle list, even where the mechanism is the same CSS.
    readonly forcedColorsSliderNeedles: readonly string[];
  };
};

// Enforces the theme contract from issue #10: consumers must be able to restyle
// everything without specificity fights or forks. Two CSS tools make that work,
// and both have to hold for every rule in the file -- one unlayered selector or
// one selector with real specificity is enough to make a consumer fight the
// stylesheet, and that is exactly what cannot be caught by eye in review.
const themeSource = await readFile(
  new URL('../theme.css', import.meta.url),
  'utf8'
);

// Strips comments so a selector-shaped example inside one is not analysed.
const withoutComments = themeSource.replace(/\/\*[\s\S]*?\*\//g, '');

const fixtures: readonly StylesheetFixture[] = [
  {
    label: 'theme.css',
    source: themeSource,
    exportPath: './theme.css',
    expected: {
      atRules: ['layer', 'media'],
      pseudoFunctions: ['where'],
      // All four are vendor-prefixed and never standardised, so none has a
      // Baseline date to move the floor with -- but every engine has shipped
      // its own family since long before Chrome 99, Firefox 97 and Safari
      // 15.4, and none has an unprefixed spelling to migrate to.
      //
      // The three `::-moz-*` names were absent until #190's Gecko half, on the
      // stated grounds that `::-moz-range-thumb` "honours no paint property
      // while the native appearance is on, so a rule naming it would be dead
      // CSS". Pixel-differencing real Firefox builds disproved that. It honours
      // no `outline` and no `box-shadow`, which is what had been probed; it
      // does honour `background-color`, `border` and its own box metrics. What
      // is true is the consequence: the first paint property to reach any part
      // of a range input switches Gecko's native widget off for the whole
      // control, so the track and the `accent-color` progress fill have to be
      // drawn here too. That is why three names arrived together rather than
      // one.
      pseudoElements: [
        '-moz-range-progress',
        '-moz-range-thumb',
        '-moz-range-track',
        '-webkit-slider-thumb'
      ],
      // `calc` and `linear-gradient` are far below the floor (IE9 and Safari
      // 6.1 respectively) and do not set it; they are listed because every
      // inventory here is exhaustive rather than a floor-setting subset.
      functions: ['calc', 'env', 'linear-gradient', 'rgb', 'var'],
      // One needle per rule the query holds, each chosen to occur in the file
      // exactly where that rule is and nowhere else. The three `::-moz-*` names
      // are #190's; the rest are #415's, and they are listed by selector text
      // rather than by pseudo-element name because `::-webkit-slider-thumb`
      // also names the shared ring rule, which lives OUTSIDE this query and has
      // to.
      forcedColorsSliderNeedles: [
        '::-moz-range-track',
        '::-moz-range-progress',
        '::-moz-range-thumb',
        // `appearance: none` on the seek input, which is what turns Blink's and
        // WebKit's native widget off. Both occurrences -- this one and the
        // thumb rule's own -- are inside.
        'appearance: none',
        // The rule the line above sits in, so moving `position: relative` out
        // alone still fails: on its own that hands the bar's rows to the
        // engine's track, which is the trade this query exists to refuse.
        ":where([data-playdeck-part='seek-slider-input']) {",
        // The fill `accent-color` stopped painting once the widget went off.
        ":where([data-playdeck-part='seek-progress']) {",
        // And the thumb, redrawn whole because nothing paints it any more.
        ":where([data-playdeck-part='seek-slider-input'])::-webkit-slider-thumb"
      ]
    }
  }
];

/**
 * Strips every `:where(...)` group from a selector, including one nested
 * inside another to any depth. One pass removes only the innermost complete
 * group (a `:where(...)` whose contents themselves hold no unstripped
 * `:where(`), so the surrounding loop reruns until nothing more changes --
 * which is what makes depth unbounded rather than fixed at one level.
 */
export const stripWhereGroups = (selector: string): string => {
  let stripped = selector;
  let previous: string;
  do {
    previous = stripped;
    stripped = stripped.replace(/:where\((?:[^()]|\([^()]*\))*\)/g, '');
  } while (stripped !== previous);
  return stripped;
};

test('stripWhereGroups removes :where() nested three deep', () => {
  expect(stripWhereGroups(':where(a :where(b :where(c)))').trim()).toBe('');
});

describe.each(fixtures)(
  '$label contract',
  ({ label, source, exportPath, expected }) => {
    // Strips comments so a selector-shaped example inside one is not analysed.
    const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '');

    // Every selector list in the file: the text before each `{` that is not
    // itself an at-rule preamble.
    const selectorLists = [...withoutComments.matchAll(/([^{}]+)\{/g)]
      .map(([, selector]) => selector.trim())
      .filter((selector) => selector.length > 0 && !selector.startsWith('@'));

    test('every rule lives inside the playdeck cascade layer', () => {
      // Unlayered consumer CSS beats layered CSS whatever its specificity, so
      // the layer is what lets a consumer override without `!important`.
      expect(withoutComments).toMatch(/@layer\s+playdeck\s*\{/);

      // Nothing may sit outside the layer block. Walk braces and assert every
      // declaration block is nested within it.
      const layerStart = withoutComments.indexOf('@layer');
      const beforeLayer = withoutComments.slice(0, layerStart);
      expect(beforeLayer).not.toContain('{');

      let depth = 0;
      let layerDepth: number | undefined;
      let outsideLayer = '';
      for (let index = 0; index < withoutComments.length; index++) {
        const character = withoutComments[index];
        if (character === '{') {
          depth++;
          if (layerDepth === undefined && index > layerStart)
            layerDepth = depth;
          continue;
        }
        if (character !== '}') continue;
        if (depth === layerDepth) layerDepth = undefined;
        depth--;
        if (depth === 0) outsideLayer += withoutComments.slice(index + 1);
      }
      expect(outsideLayer.trim()).toBe('');
    });

    // The declared browser support floor (Chrome/Edge 99, Firefox 97, Safari
    // and iOS 15.4) is set by the newest CSS feature any stylesheet the package
    // ships reaches for, and `@layer` is the feature that put it there. Nothing
    // recomputes the floor when a rule is added, so each fixture freezes its own
    // inventory instead: a new at-rule, functional pseudo-class, pseudo-element
    // or CSS function fails here, and moving the floor becomes a deliberate act
    // with a docs change attached rather than a side effect of a styling tweak.
    //
    // This gates the inventory, not a feature-to-version mapping -- no caniuse
    // dataset to refresh, nothing that rots.
    test('uses only the CSS features the declared support floor covers', () => {
      const atRules = new Set(
        [...withoutComments.matchAll(/@([a-z-]+)/g)].map(([, name]) => name)
      );
      const pseudoFunctions = new Set(
        [...withoutComments.matchAll(/:([a-z-]+)\(/g)].map(([, name]) => name)
      );
      const pseudoElements = new Set(
        [...withoutComments.matchAll(/::([a-z-]+)/g)].map(([, name]) => name)
      );
      const functions = new Set(
        [...withoutComments.matchAll(/(?<![\w-:])([a-z-]+)\(/g)]
          .map(([, name]) => name)
          .filter((name) => !pseudoFunctions.has(name))
      );

      // Each list is the file's whole inventory rather than the subset that
      // sets the floor: a subset check would let a new feature through
      // unnoticed, which is the failure mode this exists to prevent.
      expect([...atRules].sort()).toEqual(expected.atRules);
      expect([...pseudoFunctions].sort()).toEqual(expected.pseudoFunctions);
      expect([...pseudoElements].sort()).toEqual(expected.pseudoElements);
      expect([...functions].sort()).toEqual(expected.functions);
    });

    test('every selector is specificity-zero via :where()', () => {
      expect(selectorLists.length).toBeGreaterThan(0);
      const offenders = selectorLists.filter((selector) => {
        // Strip every :where(...) group, including nested parens. What remains
        // must carry no specificity of its own: no class, id, attribute,
        // pseudo-class or type selector outside a :where().
        let stripped = stripWhereGroups(selector);
        // The documented exemption (#190, #415): a native range input's thumb,
        // track and progress fill are reachable only through pseudo-elements,
        // and Selectors 4 forbids a pseudo-element inside `:where()`, so no rule
        // that paints one can be specificity-zero. Each carries its
        // pseudo-element's own (0,0,1), which any single consumer class
        // outranks, and rule 1 -- the cascade layer -- still makes unlayered
        // consumer CSS win outright.
        //
        // The four names below are the exemption's whole membership, and each
        // was earned in `theme.css` first. It was one name when #414 added a
        // ring to the `::-webkit-slider-thumb` of both sliders. Gecko's half of
        // #190 added the other three: Gecko honours neither `outline` nor
        // `box-shadow` on its thumb, and the first paint property to land on any
        // part of a range input switches its native widget off for the whole
        // control, so the ring there costs a redraw of the track and the
        // progress fill as well. #415 added rules without adding a name, because
        // the seek slider is now drawn rather than decorated on all three
        // engines: it takes a `::-webkit-slider-thumb` rule of its own, and one
        // more rule silences `::-moz-range-track` and `::-moz-range-progress`
        // for that one input so the theme's bar is its track and `seek-progress`
        // its fill.
        //
        // The list is not per fixture because it describes the engines rather
        // than any one stylesheet: these are the parts of a range input that no
        // selector can reach from inside a `:where()`, whatever paints them.
        //
        // Still removed by exact name, one name at a time, so any OTHER
        // pseudo-element -- and every class, id, attribute or type selector left
        // outside a `:where()` -- still fails below.
        for (const exempt of [
          '::-webkit-slider-thumb',
          '::-moz-range-track',
          '::-moz-range-progress',
          '::-moz-range-thumb'
        ])
          stripped = stripped.split(exempt).join('');
        return /[.#[]|::?[a-z]|[a-z]/i.test(stripped.replace(/[\s,>+~*]/g, ''));
      });
      expect(offenders).toEqual([]);
    });

    test('every button-shaped part is carried by every button rule', () => {
      // The button rules are hand-listed selector groups, so a new control
      // primitive is styled only if someone remembers to add it to all of them
      // -- and a control that misses one silently loses its box, its hover tint
      // or its forced-colors border while looking fine everywhere else.
      const buttonParts = [
        'play-button',
        'mute-button',
        'captions-button',
        'fullscreen-button',
        'pip-button',
        'airplay-button',
        'settings-menu-trigger'
      ];
      // Anchored on "mentions any button part" rather than on one named part.
      // Anchoring on `play-button` missed a rule listing only, say, mute-button
      // and pip-button; anchoring on "two or more" then missed a rule that names
      // exactly one -- which is the shape that silently drops a single control's
      // hover tint, the very failure this test exists to catch.
      //
      // And every named part has to be a button part, not merely one of them.
      // The volume reveal's
      // `[data-playdeck-part='mute-button']:hover +
      // [data-playdeck-part='volume-slider']` names a button alongside a
      // slider, but its subject is the slider: it reaches past the button
      // rather than styling it, so it is out of scope for a check that guards
      // the shared button box, not a rule that has dropped six controls from
      // one.
      const buttonRules = selectorLists.filter((selector) => {
        const namedParts = [
          ...selector.matchAll(/data-playdeck-part='([a-z-]+)'/g)
        ].map(([, name]) => name);
        return (
          namedParts.some((name) => buttonParts.includes(name)) &&
          namedParts.every((name) => buttonParts.includes(name))
        );
      });
      expect(buttonRules.length).toBeGreaterThan(0);
      const missing = buttonRules.flatMap((rule) =>
        buttonParts
          .filter((part) => !rule.includes(`data-playdeck-part='${part}'`))
          .map((part) => `${part} missing from: ${rule.replace(/\s+/g, ' ')}`)
      );
      expect(missing).toEqual([]);
    });

    test('sizes the activation part with a min-* floor, not a fixed size', () => {
      // An explicit `inline-size`/`block-size` on the activation part beats a
      // consumer's own padding or `min-height` however they write it, because a
      // used value is not a fallback — imposing the badge look on any labelled
      // affordance rather than offering it as a default. Measured on the
      // fixed-size rule, a button carrying the `white-space: nowrap` label
      // "Watch the trailer" at 16px system-ui: the box stayed 64px wide while
      // its own content wanted 96.55px on chromium and 111.83px on firefox, so
      // the label ran outside the circle drawn for an icon. Under the floor
      // below the same button measures 120.55px and 135.83px and the icon-only
      // one is still 64px square. A `min-*` floor keeps that default and
      // lets anything wider grow, and `border-radius: 2rem` draws the circle at
      // that size and a pill past it, where `50%` would draw an ellipse.
      const activationRule = withoutComments.match(
        /:where\(\[data-playdeck-part='activation'\]\)\s*\{[^}]*\}/
      )?.[0];
      expect(activationRule).toBeDefined();
      // `padding-inline` is absorbed by the floor rather than added to it only
      // under `border-box`, so without it the icon-only badge becomes a pill.
      expect(activationRule).toMatch(/box-sizing:\s*border-box/);
      expect(activationRule).toMatch(
        /min-inline-size:\s*var\(--playdeck-activation-size,\s*4rem\)/
      );
      expect(activationRule).toMatch(
        /min-block-size:\s*var\(--playdeck-activation-size,\s*4rem\)/
      );
      expect(activationRule).toMatch(
        /padding-inline:\s*var\(--playdeck-space-3/
      );
      // A floor alone does not size a box, and this part is positioned
      // `position: absolute; inset: 0` by the primitive that renders it, where
      // an `auto` size is solved to fill the containing block rather than
      // shrinking to fit. Without a stated size the badge paints over the whole
      // picture and `margin: auto` has no leftover space to centre it -- which
      // is a full-bleed box that is still perfectly concentric, so a centring
      // assertion passes on it. `stories/theme.stories.tsx`'s
      // `ActivationIsCentred` measures that from a rendered story; this asserts
      // the structural reason for it, and covers any theme drawing this part.
      expect(activationRule).toMatch(/inline-size:\s*fit-content/);
      expect(activationRule).toMatch(/block-size:\s*fit-content/);
      expect(activationRule).not.toMatch(/(?<!min-)inline-size:\s*4rem/);
      expect(activationRule).not.toMatch(/(?<!min-)block-size:\s*4rem/);
    });

    // The control bar is two rows and no wrapper element draws them: `Controls`
    // renders one part and takes `children` opaquely. The split comes from
    // `flex-wrap: wrap` on that part plus a 100% basis on the seek slider, which
    // lands on its own line because the contract puts it first in the composed
    // children — so its basis is the first thing wrap has to place. A consumer
    // who reorders the children loses the split, which is the price of not
    // materialising a `controls-row` element inside their markup.
    test('wraps the control bar and gives the seek slider its own row', () => {
      const controlsRule = withoutComments.match(
        /:where\(\[data-playdeck-part='controls'\]\)\s*\{[^}]*\}/
      )?.[0];
      expect(controlsRule).toMatch(/flex-wrap:\s*wrap/);
      const seekRule = withoutComments.match(
        /:where\(\[data-playdeck-part='seek-slider'\]\)\s*\{[^}]*\}/
      )?.[0];
      expect(seekRule).toMatch(/flex:\s*1\s+1\s+100%/);
    });

    // An auto inline-end margin on the duration `Time` eats the second row's
    // free space, which is what holds the trailing buttons against the end. It
    // is stated on that element rather than on the first trailing button
    // because every control is gated and renders nothing when its provider
    // cannot honour it: an absent `CaptionsButton` would take the margin with
    // it, and the group would collapse back to the start.
    //
    // Measured from a rendered bar composed in the contract order at 640px:
    // without this the row packs left and the gap between the duration `Time`
    // and `CaptionsButton` is the bar's own 4px `gap`; with it that gap is
    // 152.2px on Chromium and 152.25px on Firefox, and the trailing group sits
    // flush against the bar's inner end.
    test('pushes the trailing controls to the end with the duration Time', () => {
      expect(withoutComments).toMatch(
        /\[data-playdeck-part='time'\]\[data-time-type='duration'\][^{]*\{[^}]*margin-inline-end:\s*auto/
      );
    });

    // The slider keeps its box at rest and only its paint changes, so no
    // neighbour moves when it appears. Measured by driving the Theme/Theme
    // story, whose bar is `position: absolute; inset: auto 0 0 0` inside a
    // relatively positioned 640px viewport: at rest and revealed alike the
    // slider is 80x44 at x=120, and the gap from the mute button's inline end
    // to the duration `Time` is 88px — identical in both states, on chromium
    // and on firefox. What does change is `opacity` 0 -> 1 and
    // `pointer-events` `none` -> `auto`, on hovering the mute button, on
    // moving the pointer from it onto the slider, and on focusing the slider;
    // all three return to rest when the pointer leaves and the input blurs.
    // Under an emulated coarse pointer (`matchMedia('(pointer: coarse)')`
    // true) the same slider computes `display: none` and measures 0x0, and
    // that 88px gap collapses to the bar's own 4px.
    test('hides the volume slider at rest on a fine pointer and reveals it on hover or focus', () => {
      expect(withoutComments).toMatch(
        /@media\s*\(\s*pointer:\s*fine\s*\)\s*\{[^]*?opacity:\s*0;[^]*?pointer-events:\s*none;[^]*?\}/
      );
      // `\s*` around the combinator, not a literal space: the formatter breaks
      // this selector across two lines, and whitespace between a combinator and
      // its operands is not part of what is being asserted.
      expect(withoutComments).toMatch(
        /mute-button'\]:hover\s*\+\s*\[data-playdeck-part='volume-slider'\]/
      );
      expect(withoutComments).toMatch(/volume-slider'\]:focus-within/);
    });

    test('hides the volume slider outright on a coarse pointer', () => {
      expect(withoutComments).toMatch(
        /@media\s*\(\s*pointer:\s*coarse\s*\)\s*\{[^]*?volume-slider'\][^]*?display:\s*none/
      );
    });

    test('declares no !important', () => {
      // A theme that needs !important has already lost the override argument.
      expect(withoutComments).not.toMatch(/!\s*important/i);
    });

    test('disables nonessential motion under prefers-reduced-motion', () => {
      expect(withoutComments).toMatch(
        /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)/
      );
    });

    test('keeps control states distinguishable in forced-colors mode', () => {
      expect(withoutComments).toMatch(
        /@media\s*\(\s*forced-colors\s*:\s*active/
      );
    });

    // A hand-drawn slider works by switching an engine's native range widget
    // off, and forced colors is the mode where that widget was the only thing
    // painting the control in the user's own palette. Unguarded, #190's Gecko
    // volume slider flattened to `Canvas` -- the progress fill and the unfilled
    // track alike at `rgb(255 255 255)`, 1.00:1, so the slider stated no value
    // at all. #415's seek slider is held out of the mode for the same reason and
    // at a measured price, which `theme.css` records where it draws that
    // control: positioning the input there takes the loaded range from 21.00:1
    // against the unfilled one to 1.00:1 on Chromium, and drawing the control
    // there flattens Gecko's thumb to between 2.05:1 and 2.85:1 against the
    // canvas. Any stylesheet that draws the same controls buys the same trade,
    // which is why the guard is asserted per fixture against the needles that
    // fixture names.
    // `e2e/thumb-contrast.spec.ts` measures that from rendered pixels; this
    // asserts the structural reason for it, which costs no browser and fails in
    // the same edit.
    test('leaves every hand-drawn slider rule out of forced-colors mode', () => {
      const query = /@media\s*\(\s*forced-colors\s*:\s*none\s*\)/.exec(
        withoutComments
      );
      expect(query).not.toBeNull();

      // Walk to the `}` that closes the query, so "inside it" is the block and
      // not everything after the preamble.
      const start = query!.index;
      let depth = 0;
      let end = withoutComments.indexOf('{', start);
      for (; end < withoutComments.length; end++) {
        if (withoutComments[end] === '{') depth++;
        else if (withoutComments[end] === '}' && --depth === 0) break;
      }

      const names = expected.forcedColorsSliderNeedles;
      const guarded = withoutComments.slice(start, end + 1);
      expect(names.filter((name) => guarded.includes(name))).toEqual(names);
      // And nowhere outside it, or the query is decorative: one unguarded paint
      // property on any part is enough to switch the whole native widget off.
      const elsewhere =
        withoutComments.slice(0, start) + withoutComments.slice(end + 1);
      expect(names.filter((name) => elsewhere.includes(name))).toEqual([]);
    });

    test(`is reachable as @playdeck/react/${label} and shipped in the tarball`, async () => {
      const manifest = JSON.parse(
        await readFile(new URL('../package.json', import.meta.url), 'utf8')
      ) as {
        exports: Record<string, unknown>;
        files: string[];
      };
      expect(manifest.exports[exportPath]).toBe(exportPath);
      expect(manifest.files).toContain(exportPath.replace(/^\.\//, ''));
    });
  }
);

describe('theme contract', () => {
  // `sideEffects` is an array here, which means "these files and nothing else".
  // A stylesheet left out of it is declared side-effect-free, and a bundler is
  // then entitled to drop a consumer's bare `import
  // '@playdeck/react/theme.css'` -- it imports no binding, so with no side
  // effects to preserve there is nothing left to keep. The failure is an
  // unstyled player in a production build, with no error at build time and none
  // at runtime, while the dev server (which does not tree-shake) looks right.
  //
  // Asserted over every stylesheet the package exports rather than over
  // `theme.css` by name, because the point is the rule and not the one file:
  // the next theme to be exported has to be covered too, and nothing else
  // would notice if it were not.
  test('declares every exported stylesheet to have side effects', async () => {
    const manifest = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8')
    ) as { exports: unknown; sideEffects: unknown };

    const stylesheets = (function collect(node: unknown): string[] {
      if (typeof node === 'string') return node.endsWith('.css') ? [node] : [];
      if (typeof node !== 'object' || node === null) return [];
      return Object.values(node).flatMap(collect);
    })(manifest.exports);
    // Guards the guard: an `exports` map that stopped naming any stylesheet
    // would otherwise satisfy this vacuously.
    expect(stylesheets).toContain('./theme.css');

    // Only the array form is restrictive. `true` and an absent field both mean
    // every file has side effects, and `false` means none do, which no CSS-
    // shipping package can say.
    expect(Array.isArray(manifest.sideEffects)).toBe(true);
    const patterns = manifest.sideEffects as string[];

    // The subset of glob syntax webpack resolves these with: `*` stops at a
    // path separator, `**` crosses them, and a pattern naming no directory is
    // matched against the basename rather than the whole path.
    const matches = (pattern: string, path: string): boolean => {
      const subject = pattern.includes('/')
        ? path.replace(/^\.\//, '')
        : path.slice(path.lastIndexOf('/') + 1);
      const source = pattern
        .replace(/^\.\//, '')
        .split('**')
        .map((part) =>
          part.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')
        )
        .join('.*');
      return new RegExp(`^${source}$`).test(subject);
    };

    const uncovered = stylesheets.filter(
      (stylesheet) => !patterns.some((pattern) => matches(pattern, stylesheet))
    );
    expect(uncovered).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Non-text contrast (#190).
//
// WCAG 2.2 AA 1.4.11 puts a 3:1 floor under the visual boundary of a
// user-interface component, and AA is a release gate for this library. The seek
// slider's boundaries are painted from this file's own token defaults, so they
// are checkable as arithmetic -- and they have to be. axe-core implements 1.4.3
// (text only) and ships no 1.4.11 rule, and the composition the a11y suite
// scans deliberately never mounts this stylesheet, so an axe run passes either
// side of a regression here and reports nothing at all.
//
// Measured against the backdrop token alone. The control surface really sits
// over a scrim over arbitrary video frames, so a translucent white part lands
// *closer* to its surround over any brighter frame: these ratios are a ceiling,
// not a typical case. Widening the target to a worst-case video ground is a
// deliberate, recorded simplification of #190, not an oversight here.

/**
 * The default a token is read with, taken from the shipped file rather than
 * restated here. That is the point: editing a default without editing the
 * ratios below has to fail, or this check drifts away from what ships.
 *
 * Every `var()` read of a token has to agree on its fallback -- the backdrop is
 * read by two rules -- so disagreement is itself a failure, and so is a token
 * this file only declares, since a declaration would beat a consumer's
 * inherited value and there would be no `var(name, default)` to find.
 */
const tokenDefault = (name: string): string => {
  const reads = new RegExp(`var\\(\\s*${name}\\s*,\\s*`, 'g');
  const defaults = new Set<string>();
  for (
    let read = reads.exec(withoutComments);
    read !== null;
    read = reads.exec(withoutComments)
  ) {
    // Scan to the `)` that closes this `var()`, so a nested `rgb(...)` in the
    // fallback position is taken whole.
    const start = read.index + read[0].length;
    let depth = 1;
    let end = start;
    for (; end < withoutComments.length && depth > 0; end++) {
      if (withoutComments[end] === '(') depth++;
      else if (withoutComments[end] === ')') depth--;
    }
    defaults.add(withoutComments.slice(start, end - 1).trim());
  }
  if (defaults.size !== 1)
    throw new Error(
      `${name}: expected one fallback default in theme.css, found ${
        defaults.size === 0 ? 'none' : [...defaults].join(' / ')
      }`
    );
  return [...defaults][0];
};

describe('slider non-text contrast', () => {
  const backdrop = parseColor(tokenDefault('--playdeck-color-backdrop'));
  const track = over(
    parseColor(tokenDefault('--playdeck-color-track')),
    backdrop
  );
  // Over the track, not over the backdrop. `seek-buffered-range` nests inside
  // `seek-buffered`, which paints `--playdeck-color-track` first, so a loaded
  // range reaches the screen composited over the track and never over the
  // ground behind it. Compositing it over the backdrop was conservative rather
  // than wrong -- it put the loaded range at 178.5 where it renders at 206 --
  // but every ratio derived from it moved, and the figures below now agree with
  // what `e2e/thumb-contrast.spec.ts` samples off the screen (#415).
  const buffered = over(
    parseColor(tokenDefault('--playdeck-color-buffered')),
    track
  );
  const accent = over(
    parseColor(tokenDefault('--playdeck-color-accent')),
    backdrop
  );
  const ring = over(
    parseColor(tokenDefault('--playdeck-color-thumb-ring')),
    backdrop
  );

  const ratios = {
    'track vs backdrop': contrast(track, backdrop),
    'buffered vs track': contrast(buffered, track),
    'buffered vs backdrop': contrast(buffered, backdrop),
    'accent vs backdrop': contrast(accent, backdrop),
    'accent vs track': contrast(accent, track),
    'accent vs buffered': contrast(accent, buffered),
    'ring vs track': contrast(ring, track),
    'ring vs buffered': contrast(ring, buffered),
    'accent vs ring': contrast(accent, ring)
  };

  // What is asserted, and what is not.
  //
  // The scrubbable track against the ground behind it, and the loaded range
  // against the unfilled track, are the two boundaries a low-vision user needs
  // to read off the bar itself.
  //
  // The thumb is the third, and it is carried by the ring rather than by the
  // accent fill. That is the resolution of #190 and it is arithmetic, not
  // preference: `#3ea6ff` has a relative luminance of 0.3552, and to clear 3:1
  // against the buffered range a colour must sit at or above 1.4440 or at or
  // below 0.1160 -- and 1.4440 is brighter than white, whose luminance is 1.0.
  // No accent value satisfies both surfaces, so the boundary is supplied by
  // `--playdeck-color-thumb-ring` and the accent stays free to be a brand
  // colour. 1.4.11 asks for contrast on the visual information that identifies
  // the component, which a boundary supplies as well as a fill does.
  //
  // The two accent-vs-surface ratios stay measured and stated below at their
  // real, failing values, because the fill really does sit at 2.59:1 and 1.65:1
  // and hiding that would misrepresent what ships. They are not asserted
  // because they are unreachable, not because they are unimportant -- what is
  // asserted instead is that the ring clears both surfaces and that the fill
  // stays legible inside its own ring.
  //
  // Since #415 those two are also the boundaries of a part in their own right.
  // The seek slider's played span is no longer `accent-color` on an engine's
  // native widget but `seek-progress`, an element the primitive positions and
  // this file paints `--playdeck-color-accent`, so `accent vs track` and
  // `accent vs buffered` describe its two edges exactly. Neither figure moved
  // with the part: `e2e/thumb-contrast.spec.ts` samples them off the screen at
  // 2.28:1 and 1.69:1 -- the same pair over the story's lighter ground -- and
  // pins them there, on all three engines, so a change that moves either has to
  // restate it in both files.
  //
  // What the three ring ratios do not add. `--playdeck-color-thumb-ring`
  // defaults to `#000`, which is also the `--playdeck-color-backdrop` default,
  // so today `ring vs track`, `ring vs buffered` and `accent vs ring` are
  // numerically the same three figures as `track vs backdrop`, `buffered vs
  // backdrop` and `accent vs backdrop` above them. They still earn their place
  // -- they pin a second token, and they diverge the moment either default
  // moves -- but they are not three independent measurements today, and reading
  // them as such overstates how much of the control is covered.
  //
  // Two boundaries nothing here measures. The thumb is taller than the 0.25rem
  // track, so the ring's outer edge meets the control scrim rather than either
  // slider surface, and no pair of tokens describes that. And the volume slider
  // is painted a track by this file on Gecko only (`::-moz-range-track`, #190),
  // so on Blink and WebKit what sits beside its thumb is the engine's own
  // unfilled track and no token describes it.
  //
  // What none of it measures is a rendered pixel, and until #415 the two
  // answers disagreed: every engine painted its own native track under this
  // file's `seek-buffered` bar, and the bar was absolutely positioned while the
  // input was not, so the bar composited OVER the control and lifted the whole
  // thumb -- ring included -- towards white. `ring vs buffered` said 9.96:1 and
  // the screen said 1.03:1.
  //
  // The theme now draws the whole seek control, so the pixels beside its thumb
  // are the ones composited here rather than an engine's. The two answers still
  // differ, and by design: these ratios composite onto `--playdeck-color-backdrop`
  // alone, while the story they are measured on has a ground of `rgb(11 14 19)`.
  // Rendered against arithmetic: 3.55:1 against 3.13:1 for the ring on the
  // track, 13.73:1 against 13.35:1 for the ring on the loaded range, 3.86:1
  // against 4.26:1 for the loaded range on the track. Not all one direction, and
  // that is what a lighter ground does rather than a discrepancy: it lifts a
  // translucent white further where less of that white is opaque, so the track
  // gains more than the range above it and the boundary between the two closes
  // while both boundaries against the ring open.
  // `e2e/thumb-contrast.spec.ts` is what measures the screen.
  //
  // Which makes `ring vs track` the row to read carefully, because the pixel
  // gate never sees its worst case. `--playdeck-color-track` is a translucent
  // white, so how far the ring clears it is a property of whatever is behind
  // the slider. On this file's own `--playdeck-color-backdrop` default of `#000`
  // -- the darkest ground there is, and the one a consumer who sets no token
  // gets -- it is the 3.13:1 stated below, a margin of 0.13 over the floor
  // (3.14:1 from the rendered `rgb(92 92 92)` that ground paints, the same
  // margin either way). The story the pixel gate runs on has a lighter ground of
  // `rgb(11 14 19)`, where the same boundary measures 3.55:1. So this
  // arithmetic, not the screenshot, is what holds the worst case, and moving
  // either `--playdeck-color-track`'s alpha or `--playdeck-color-thumb-ring`
  // spends a margin thinner than the pixels ever show.
  const asserted = [
    'track vs backdrop',
    'buffered vs track',
    'ring vs track',
    'ring vs buffered',
    'accent vs ring'
  ] as const;

  test('every asserted boundary clears the 3:1 floor', () => {
    const belowFloor = asserted
      .filter((boundary) => ratios[boundary] < 3)
      .map(
        (boundary) =>
          `${boundary}: ${ratios[boundary].toFixed(4)}:1 is below the 3:1 floor`
      );
    expect(belowFloor).toEqual([]);
  });

  // Every ratio in one place, asserted rather than logged, so a reviewer checks
  // the arithmetic instead of trusting it -- and so that moving a token default
  // without restating what it does to each boundary cannot pass.
  test('states the composited ratio of every slider boundary', () => {
    const stated = Object.fromEntries(
      Object.entries(ratios).map(([boundary, ratio]) => [
        boundary,
        `${ratio.toFixed(2)}:1`
      ])
    );
    expect(stated).toEqual({
      'track vs backdrop': '3.13:1',
      'buffered vs track': '4.26:1',
      'buffered vs backdrop': '13.35:1',
      'accent vs backdrop': '8.10:1',
      'accent vs track': '2.59:1',
      'accent vs buffered': '1.65:1',
      'ring vs track': '3.13:1',
      'ring vs buffered': '13.35:1',
      'accent vs ring': '8.10:1'
    });
  });
});

describe('headless import chain', () => {
  test('no primitive source file imports CSS', async () => {
    // The whole point of the separate entry: importing a primitive must never
    // drag a stylesheet in, or the "headless primitives import no CSS" rule in
    // issue #1 is broken for every consumer.
    const source = await readFile(
      new URL('../src/index.tsx', import.meta.url),
      'utf8'
    );
    expect(source).not.toMatch(/import\s+['"][^'"]+\.css['"]/);
    expect(source).not.toMatch(/from\s+['"][^'"]+\.css['"]/);
  });
});

// ---------------------------------------------------------------------------
// The overlay rules, and why they are not inside the `describe.each` above.
//
// Both belong to `theme.css` alone, for the same reason: they exist to protect
// a bar drawn over the picture, and `docked.css` never draws one. It reads no
// `data-idle` at all, and it has no scrim to flatten below 48rem — so an
// assertion placed in the parameterised suite would run against that fixture
// too and fail on it forever. They read the module-scope `withoutComments` the
// same way `theme contract` and `slider non-text contrast` do.
describe('theme.css overlay rules (not shared with docked.css)', () => {
  // The idle state is the selected one, so an absent `data-idle` renders
  // exactly like `data-idle='false'`. That is what the attribute's own
  // lifetime requires: `Viewport` writes it from an effect that returns early
  // while its node is still null, so there is a first paint with no attribute
  // at all, and a rule keyed on `[data-idle='false']` to mean "visible" would
  // leave the bar hidden across it.
  test('fades the control surface out while data-idle, and back in on focus-within', () => {
    expect(withoutComments).toMatch(
      /:where\(\[data-idle='true'\] \[data-playdeck-part='controls'\]\)\s*\{[^}]*opacity:\s*0;[^}]*pointer-events:\s*none;/
    );
    expect(withoutComments).toMatch(
      /:where\(\[data-playdeck-part='controls'\]:focus-within\)\s*\{[^}]*opacity:\s*1;/
    );
  });

  // Two declarations inside one `max-width: 48rem` query, and no third: the
  // narrow fallback flattens the scrim and drops the volume slider, and says
  // nothing about where the bar sits. A `position` written here would be
  // layered `:where()` CSS, which the unlayered rule a real composition uses to
  // float the bar beats whatever this file said — so the query claims only what
  // it can deliver. Moving the bar out of the overlay is `docked.css`'s job,
  // and that theme never puts it there to begin with.
  test('flattens the scrim and drops the volume slider below 48rem', () => {
    const query = withoutComments.match(
      /@media\s*\(\s*max-width:\s*48rem\s*\)\s*\{[^]*?\n {2}\}/
    )?.[0];
    expect(query).toBeDefined();
    expect(query).toMatch(
      /background:\s*var\(--playdeck-color-surface,\s*rgb\(0 0 0 \/ 0\.72\)\)/
    );
    expect(query).toMatch(/volume-slider'\][^]*?display:\s*none/);
    expect(query).not.toMatch(/position:/);
  });
});
