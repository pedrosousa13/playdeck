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
  test('every rule lives inside the reely cascade layer', () => {
    // Unlayered consumer CSS beats layered CSS whatever its specificity, so the
    // layer is what lets a consumer override without `!important`.
    expect(withoutComments).toMatch(/@layer\s+reely\s*\{/);

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
      buttonParts.some((part) => selector.includes(`data-reely-part='${part}'`))
    );
    expect(buttonRules.length).toBeGreaterThan(0);
    const missing = buttonRules.flatMap((rule) =>
      buttonParts
        .filter((part) => !rule.includes(`data-reely-part='${part}'`))
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

  test('is reachable as @reely/react/theme.css and shipped in the tarball', async () => {
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
