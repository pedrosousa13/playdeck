// @vitest-environment node
// Reads files off disk rather than rendering anything, and happy-dom's global
// `URL` cannot resolve `import.meta.url` into a file path.

import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import { describe, expect, test } from 'vitest';

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
  // inventory instead: a new at-rule, functional pseudo-class or CSS function
  // fails here, and moving the floor becomes a deliberate act with a docs
  // change attached rather than a side effect of a styling tweak.
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
    const functions = new Set(
      [...withoutComments.matchAll(/(?<![\w-:])([a-z-]+)\(/g)]
        .map(([, name]) => name)
        .filter((name) => !pseudoFunctions.has(name))
    );

    expect([...atRules].sort()).toEqual(['layer', 'media']);
    expect([...pseudoFunctions].sort()).toEqual(['where']);
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

type Rgba = { red: number; green: number; blue: number; alpha: number };

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

const parseColor = (value: string): Rgba => {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  if (hex !== null) {
    const digits = hex[1];
    const channel = (index: number): number =>
      digits.length === 3
        ? Number.parseInt(digits[index].repeat(2), 16) / 255
        : Number.parseInt(digits.slice(index * 2, index * 2 + 2), 16) / 255;
    return { red: channel(0), green: channel(1), blue: channel(2), alpha: 1 };
  }
  const rgb = /^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*\/\s*([\d.]+)\s*\)$/i.exec(
    value
  );
  if (rgb !== null)
    return {
      red: Number(rgb[1]) / 255,
      green: Number(rgb[2]) / 255,
      blue: Number(rgb[3]) / 255,
      alpha: Number(rgb[4])
    };
  throw new Error(`theme.css: cannot parse the colour default \`${value}\``);
};

/** Source-over composite of a translucent colour onto an opaque ground. */
const over = (color: Rgba, ground: Rgba): Rgba => {
  if (ground.alpha !== 1)
    throw new Error('the ground colour must be opaque to composite against');
  const blend = (top: number, bottom: number): number =>
    top * color.alpha + bottom * (1 - color.alpha);
  return {
    red: blend(color.red, ground.red),
    green: blend(color.green, ground.green),
    blue: blend(color.blue, ground.blue),
    alpha: 1
  };
};

/** WCAG 2.x relative luminance. */
const luminance = ({ red, green, blue }: Rgba): number => {
  const linear = (channel: number): number =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
};

/** WCAG 2.x contrast ratio, `(L1 + 0.05) / (L2 + 0.05)`. */
const contrast = (one: Rgba, other: Rgba): number => {
  const [lighter, darker] = [luminance(one), luminance(other)].sort(
    (a, b) => b - a
  );
  return (lighter + 0.05) / (darker + 0.05);
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

  const ratios = {
    'track vs backdrop': contrast(track, backdrop),
    'buffered vs track': contrast(buffered, track),
    'buffered vs backdrop': contrast(buffered, backdrop),
    'accent vs backdrop': contrast(accent, backdrop),
    'accent vs track': contrast(accent, track),
    'accent vs buffered': contrast(accent, buffered)
  };

  // What is asserted, and what is not.
  //
  // The scrubbable track against the ground behind it, and the loaded range
  // against the unfilled track, are the two boundaries a low-vision user needs
  // to read off this control, and both hold under any resolution of the third.
  //
  // Neither accent boundary is asserted, and that is a stated limit of this
  // check rather than a gap to be closed later. Both are arithmetically out of
  // reach while the accent token stays `#3ea6ff`, whose relative luminance is
  // 0.3552: a colour it clears 3:1 against has to sit at or below a luminance
  // of 0.0851, and the floor above puts the track at or above 0.10 and the
  // buffered range at or above 0.40. Raising the accent's own contrast against
  // them is what the third target of #190 asked for, and it is unreachable from
  // this side -- against opaque white, the brightest the buffered range could
  // ever be, the accent still measures only 2.59:1.
  //
  // So they are measured and reported below at their real values (accent vs
  // track 2.59:1, accent vs buffered 1.23:1), and moving either needs a
  // maintainer decision about the accent token itself, recorded on #190.
  const asserted = ['track vs backdrop', 'buffered vs track'] as const;

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
      'accent vs buffered': '1.23:1'
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
