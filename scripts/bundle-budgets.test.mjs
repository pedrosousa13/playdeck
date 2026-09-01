import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, URL } from 'node:url';

import {
  measureStylesheet,
  stripCssComments,
  targets
} from './bundle-budgets.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

// The stylesheet is read rather than measured through `measureBundles`, because
// every other target lives in `dist/` and this file runs in the `static` CI job,
// which never builds one.
const themeTarget = targets.find(
  (target) => target.name === '@playdeck/react/theme.css'
);
const themeSource = () =>
  readFile(join(repoRoot, 'packages/react/theme.css'), 'utf8');

// ---- the stripper ----------------------------------------------------------
//
// What the theme's budget is now enforced against, so every case below is a way
// the enforced number could be wrong. The two directions cost differently: a
// sequence wrongly read as a comment deletes rules the budget exists to
// constrain, which is the silent one.

test('removes a comment and keeps the rules around it', () => {
  assert.equal(
    stripCssComments('a { color: red; }\n/* why */\nb { color: blue; }\n'),
    'a { color: red; }\n\nb { color: blue; }\n'
  );
});

test('keeps a comment sequence inside a double-quoted string', () => {
  const source = 'a::before { content: "/* not a comment */"; }';
  assert.equal(stripCssComments(source), source);
});

test('keeps a comment sequence inside a single-quoted string', () => {
  const source = "a::before { content: '/* not a comment */'; }";
  assert.equal(stripCssComments(source), source);
});

test('keeps a comment sequence inside an unquoted url() value', () => {
  const source =
    'a { background: url(data:image/svg+xml;utf8,<svg>/*x*/</svg>); }';
  assert.equal(stripCssComments(source), source);
});

test('keeps a comment sequence inside a quoted url() value', () => {
  const source = 'a { background: url("/*x*/"); }';
  assert.equal(stripCssComments(source), source);
});

test('does not end a string at an escaped quote', () => {
  // Without the escape handling the string would close at the middle quote and
  // the `/*` after it would open a comment that eats the rest of the file.
  const source =
    'a::before { content: "he said \\"/* hi */\\""; }\nb { top: 0 }';
  assert.equal(stripCssComments(source), source);
});

test('drops the rest of the file for an unterminated comment', () => {
  // What a browser does with one, so the measurement agrees with the consumer:
  // nothing after an unclosed `/*` is a rule.
  assert.equal(
    stripCssComments('a { top: 0 }\n/* never closed\nb { top: 1 }'),
    'a { top: 0 }\n'
  );
});

test('does not nest comments', () => {
  // CSS has no nested comments: the first `*/` closes the first `/*`, whatever
  // is between them.
  assert.equal(stripCssComments('/* /* */ a { top: 0 }'), ' a { top: 0 }');
});

test('closes a comment at the first */ even inside what looks like a string', () => {
  // A quote inside a comment is just a character, so the comment ends mid-way
  // and the remainder is left exactly as a browser would see it.
  assert.equal(
    stripCssComments('/* "*/" */ a { top: 0 }'),
    '" */ a { top: 0 }'
  );
});

test('treats url only as its own token, not as the tail of an identifier', () => {
  assert.equal(
    stripCssComments('a { --x: myurl(/* c */ 1); }'),
    'a { --x: myurl( 1); }'
  );
});

// ---- the two figures and which one is the ceiling --------------------------

test('the theme is the only target whose ceiling is on a subset', async () => {
  assert.ok(themeTarget, 'the theme stylesheet is still a budget target');
  assert.equal(themeTarget.budgetedSubset?.extract, stripCssComments);
  for (const target of targets) {
    if (target === themeTarget) continue;
    assert.equal(
      target.budgetedSubset,
      undefined,
      `${target.name} gained a subset`
    );
  }
});

test('reports the shipped size alongside the rules-only size it gates on', async () => {
  // Both figures, or the shipped one stops being observable -- which is the
  // whole reason the maintainer chose this shape over measuring rules alone.
  const { shipped, rules } = measureStylesheet(await themeSource());
  assert.ok(
    rules < shipped,
    `rules-only ${rules} should be under shipped ${shipped}`
  );
});

/** The ceiling the theme target is really declared with. */
const themeBudget = () => {
  assert.ok(themeTarget?.budget !== null && themeTarget !== undefined);
  return themeTarget.budget;
};

test('a substantial comment block does not push the theme over its budget', async () => {
  // The defect this whole change exists for: #415 added about 2 KB of prose and
  // 0.07 KB of rules, and the gate failed it. Synthetic rather than a real edit
  // to the stylesheet, because the point is the decision, not the file.
  const prose = `/*\n${'A sentence of durable rationale that a reviewer asked for.\n'.repeat(200)}*/\n`;
  const { shipped, rules } = measureStylesheet((await themeSource()) + prose);
  const budget = themeBudget();
  assert.ok(rules <= budget, `rules-only ${rules} should stay under ${budget}`);
  assert.ok(shipped > budget, 'the added prose is large enough to matter');
});

test('a substantial rule block does push the theme over its budget', async () => {
  // The other direction, and the reason the gate is worth keeping at all: the
  // ceiling still has to fail on CSS the theme did not have before.
  const added = Array.from(
    { length: 400 },
    (_, index) =>
      `.playdeck-synthetic-${index} { padding-inline: ${index}px; border-radius: ${index % 7}px; }`
  ).join('\n');
  const { rules } = measureStylesheet((await themeSource()) + added);
  const budget = themeBudget();
  assert.ok(rules > budget, `rules-only ${rules} should exceed ${budget}`);
});
