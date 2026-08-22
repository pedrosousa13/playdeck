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
      // The documented exemption (#190): a native range input's thumb, track
      // and progress fill are reachable only through pseudo-elements, and
      // Selectors 4 forbids a pseudo-element inside `:where()`, so the rules
      // that paint the thumb's ring cannot be specificity-zero. Each carries
      // its pseudo-element's own (0,0,1), which any single consumer class
      // outranks, and rule 1 -- the cascade layer -- still makes unlayered
      // consumer CSS win outright.
      //
      // Widened from `::-webkit-slider-thumb` alone when Gecko's half of #190
      // landed: Gecko honours neither `outline` nor `box-shadow` on its thumb,
      // so the ring costs a redraw of all three of its parts. Still removed by
      // exact name, one name at a time, so any OTHER pseudo-element -- and
      // every class, id, attribute or type selector left outside a `:where()`
      // -- still fails below.
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

  // #190's Gecko half works by switching that engine's native range widget off,
  // and forced colors is the mode where the widget was the only thing painting
  // the control in the user's own palette. Unguarded, the Gecko volume slider
  // flattened to `Canvas` -- the progress fill and the unfilled track alike at
  // `rgb(255 255 255)`, 1.00:1, so the slider stated no value at all.
  // `e2e/thumb-contrast.spec.ts` measures that from rendered pixels; this
  // asserts the structural reason for it, which costs no browser and fails in
  // the same edit.
  test('leaves the Gecko slider parts native in forced-colors mode', () => {
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

    const names = [
      '::-moz-range-track',
      '::-moz-range-progress',
      '::-moz-range-thumb'
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
  const buffered = over(
    parseColor(tokenDefault('--playdeck-color-buffered')),
    backdrop
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
  // real, failing values, because the fill really does sit at 2.59:1 and 1.23:1
  // and hiding that would misrepresent what ships. They are not asserted
  // because they are unreachable, not because they are unimportant -- what is
  // asserted instead is that the ring clears both surfaces and that the fill
  // stays legible inside its own ring.
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
  // What none of it measures is a rendered pixel. Every ratio here composites
  // token defaults; the engines composite something else. Each paints its own
  // native track under this file's `seek-buffered` bar, and that bar is
  // absolutely positioned while the input is not, so on Blink and Gecko the
  // bar paints OVER the control and lifts the whole thumb -- ring included --
  // towards white. That overlay defect is owned by #415.
  // `e2e/thumb-contrast.spec.ts` measures what is actually on screen and records
  // how far apart the two answers are.
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
      'buffered vs track': '3.18:1',
      'buffered vs backdrop': '9.96:1',
      'accent vs backdrop': '8.10:1',
      'accent vs track': '2.59:1',
      'accent vs buffered': '1.23:1',
      'ring vs track': '3.13:1',
      'ring vs buffered': '9.96:1',
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
