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

// Every selector list in the file: the text before each `{` that is not itself
// an at-rule preamble.
const selectorLists = [...withoutComments.matchAll(/([^{}]+)\{/g)]
  .map(([, selector]) => selector.trim())
  .filter((selector) => selector.length > 0 && !selector.startsWith('@'));

describe('theme contract', () => {
  test('every rule lives inside the playdeck cascade layer', () => {
    // Unlayered consumer CSS beats layered CSS whatever its specificity, so the
    // layer is what lets a consumer override without `!important`.
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
        if (layerDepth === undefined && index > layerStart) layerDepth = depth;
        continue;
      }
      if (character !== '}') continue;
      if (depth === layerDepth) layerDepth = undefined;
      depth--;
      if (depth === 0) outsideLayer += withoutComments.slice(index + 1);
    }
    expect(outsideLayer.trim()).toBe('');
  });

  // The declared browser support floor (Chrome/Edge 99, Firefox 97, Safari and
  // iOS 15.4) is set by the newest CSS feature in this file, which today is
  // `@layer`. Nothing recomputes that when a rule is added, so this freezes the
  // inventory instead: a new at-rule, functional pseudo-class, pseudo-element or
  // CSS function fails here, and moving the floor becomes a deliberate act with
  // a docs change attached rather than a side effect of a styling tweak.
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

    expect([...atRules].sort()).toEqual(['layer', 'media']);
    expect([...pseudoFunctions].sort()).toEqual(['where']);
    // All four are vendor-prefixed and never standardised, so none has a
    // Baseline date to move the floor with -- but every engine has shipped its
    // own family since long before Chrome 99, Firefox 97 and Safari 15.4, and
    // none has an unprefixed spelling to migrate to.
    //
    // The three `::-moz-*` names were absent until #190's Gecko half, on the
    // stated grounds that `::-moz-range-thumb` "honours no paint property while
    // the native appearance is on, so a rule naming it would be dead CSS".
    // Pixel-differencing real Firefox builds disproved that. It honours no
    // `outline` and no `box-shadow`, which is what had been probed; it does
    // honour `background-color`, `border` and its own box metrics. What is true
    // is the consequence: the first paint property to reach any part of a range
    // input switches Gecko's native widget off for the whole control, so the
    // track and the `accent-color` progress fill have to be drawn here too.
    // That is why three names arrived together rather than one.
    expect([...pseudoElements].sort()).toEqual([
      '-moz-range-progress',
      '-moz-range-thumb',
      '-moz-range-track',
      '-webkit-slider-thumb'
    ]);
    // `calc` and `linear-gradient` are far below the floor (IE9 and Safari 6.1
    // respectively) and do not set it; they are listed because this asserts the
    // whole inventory, not a subset -- a subset check would let a new feature
    // through unnoticed, which is the failure mode this exists to prevent.
    expect([...functions].sort()).toEqual([
      'calc',
      'env',
      'linear-gradient',
      'rgb',
      'var'
    ]);
  });

  test('every selector is specificity-zero via :where()', () => {
    expect(selectorLists.length).toBeGreaterThan(0);
    const offenders = selectorLists.filter((selector) => {
      // Strip every :where(...) group, including nested parens. What remains
      // must carry no specificity of its own: no class, id, attribute,
      // pseudo-class or type selector outside a :where().
      let stripped = selector;
      let previous: string;
      do {
        previous = stripped;
        stripped = stripped.replace(/:where\((?:[^()]|\([^()]*\))*\)/g, '');
      } while (stripped !== previous);
      // The documented exemption (#190, #415): a native range input's thumb,
      // track and progress fill are reachable only through pseudo-elements, and
      // Selectors 4 forbids a pseudo-element inside `:where()`, so no rule that
      // paints one can be specificity-zero. Each carries its pseudo-element's
      // own (0,0,1), which any single consumer class outranks, and rule 1 -- the
      // cascade layer -- still makes unlayered consumer CSS win outright.
      //
      // Six rules take it today, and the four names below are what they are
      // built from. It was one rule and one name when #414 added a ring to the
      // `::-webkit-slider-thumb` of both sliders. Gecko's half of #190 made it
      // four rules and four names: Gecko honours neither `outline` nor
      // `box-shadow` on its thumb, and the first paint property to land on any
      // part of a range input switches its native widget off for the whole
      // control, so the ring there costs a redraw of the track and the progress
      // fill as well. #415 made it six rules without adding a name, because the
      // seek slider is now drawn rather than decorated on all three engines: it
      // takes a `::-webkit-slider-thumb` rule of its own, and one more rule
      // silencing `::-moz-range-track` and `::-moz-range-progress` for that one
      // input so the theme's bar is its track and `seek-progress` its fill.
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
    // primitive is styled only if someone remembers to add it to all of them --
    // and a control that misses one silently loses its box, its hover tint or
    // its forced-colors border while looking fine everywhere else.
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
    const buttonRules = selectorLists.filter((selector) =>
      buttonParts.some((part) =>
        selector.includes(`data-playdeck-part='${part}'`)
      )
    );
    expect(buttonRules.length).toBeGreaterThan(0);
    const missing = buttonRules.flatMap((rule) =>
      buttonParts
        .filter((part) => !rule.includes(`data-playdeck-part='${part}'`))
        .map((part) => `${part} missing from: ${rule.replace(/\s+/g, ' ')}`)
    );
    expect(missing).toEqual([]);
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
    expect(withoutComments).toMatch(/@media\s*\(\s*forced-colors\s*:\s*active/);
  });

  // Both hand-drawn sliders work by switching an engine's native range widget
  // off, and forced colors is the mode where that widget was the only thing
  // painting the control in the user's own palette. Unguarded, #190's Gecko
  // volume slider flattened to `Canvas` -- the progress fill and the unfilled
  // track alike at `rgb(255 255 255)`, 1.00:1, so the slider stated no value at
  // all. #415's seek slider is held out of the mode for the same reason and at a
  // measured price: `theme.css` records that positioning the input there takes
  // the loaded range from 21.00:1 against the unfilled one to 1.00:1 on
  // Chromium, and that drawing the control there flattens Gecko's thumb to
  // between 2.05:1 and 2.85:1 against the canvas.
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

    // One needle per rule the query holds, each chosen to occur in the file
    // exactly where that rule is and nowhere else. The three `::-moz-*` names
    // are #190's; the rest are #415's, and they are listed by selector text
    // rather than by pseudo-element name because `::-webkit-slider-thumb` also
    // names the shared ring rule, which lives OUTSIDE this query and has to.
    const names = [
      '::-moz-range-track',
      '::-moz-range-progress',
      '::-moz-range-thumb',
      // `appearance: none` on the seek input, which is what turns Blink's and
      // WebKit's native widget off. Both occurrences -- this one and the thumb
      // rule's own -- are inside.
      'appearance: none',
      // The rule the line above sits in, so moving `position: relative` out
      // alone still fails: on its own that hands the bar's rows to the engine's
      // track, which is the trade this query exists to refuse.
      ":where([data-playdeck-part='seek-slider-input']) {",
      // The fill `accent-color` stopped painting once the widget went off.
      ":where([data-playdeck-part='seek-progress']) {",
      // And the thumb, redrawn whole because nothing paints it any more.
      ":where([data-playdeck-part='seek-slider-input'])::-webkit-slider-thumb"
    ];
    const guarded = withoutComments.slice(start, end + 1);
    expect(names.filter((name) => guarded.includes(name))).toEqual(names);
    // And nowhere outside it, or the query is decorative: one unguarded paint
    // property on any part is enough to switch the whole native widget off.
    const elsewhere =
      withoutComments.slice(0, start) + withoutComments.slice(end + 1);
    expect(names.filter((name) => elsewhere.includes(name))).toEqual([]);
  });

  test('is reachable as @playdeck/react/theme.css and shipped in the tarball', async () => {
    const manifest = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8')
    ) as {
      exports: Record<string, unknown>;
      files: string[];
      sideEffects: unknown;
    };
    expect(manifest.exports['./theme.css']).toBe('./theme.css');
    expect(manifest.files).toContain('theme.css');
  });

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
