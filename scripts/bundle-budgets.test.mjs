import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, URL } from 'node:url';

import {
  measureTarget,
  overBudget,
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

const dockedTarget = targets.find(
  (target) => target.name === '@playdeck/react/docked.css'
);
const dockedSource = () =>
  readFile(join(repoRoot, 'packages/react/docked.css'), 'utf8');

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

test('ends an unterminated string at a carriage return, not only a newline', () => {
  // CSS ends a string at a newline, a carriage return or a form feed. Were the
  // scanner to run past one, the `/*` on the next line would open a comment
  // that swallowed the rules after it and lowered the enforced number.
  assert.equal(
    stripCssComments('a::before { content: "oops\r/* c */\nb { top: 0 }'),
    'a::before { content: "oops\r\nb { top: 0 }'
  );
  assert.equal(
    stripCssComments('a::before { content: "oops\f/* c */\nb { top: 0 }'),
    'a::before { content: "oops\f\nb { top: 0 }'
  );
});

// ---- the two figures and which one is the ceiling --------------------------

test('the stylesheets are the only targets whose ceiling is on a subset', async () => {
  assert.ok(themeTarget, 'the theme stylesheet is still a budget target');
  assert.ok(dockedTarget, 'the docked stylesheet is still a budget target');
  for (const target of [themeTarget, dockedTarget]) {
    assert.equal(target.budgetedSubset?.extract, stripCssComments);
  }
  for (const target of targets) {
    if (target === themeTarget || target === dockedTarget) continue;
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
  assert.ok(themeTarget);
  const { size, budgeted } = measureTarget(themeTarget, await themeSource());
  assert.equal(budgeted?.label, 'CSS rules');
  assert.ok(
    budgeted !== null && budgeted.size < size,
    `rules-only ${budgeted?.size} should be under shipped ${size}`
  );
});

test("reports docked.css's shipped size alongside its rules-only size", async () => {
  // The same two figures the theme reports, for the same reason: docked.css
  // also ships as authored, so its prose is bytes a consumer downloads and has
  // to stay observable even though the ceiling is not on it.
  assert.ok(dockedTarget);
  const { size, budgeted } = measureTarget(dockedTarget, await dockedSource());
  assert.equal(budgeted?.label, 'CSS rules');
  assert.ok(
    budgeted !== null && budgeted.size < size,
    `rules-only ${budgeted?.size} should be under shipped ${size}`
  );
});

test('docked.css is inside its budget as it stands', async () => {
  // The gate's own decision, run against the real file rather than a synthetic
  // one: the budget is set from a measurement, so a budget set below the file
  // it was measured from would otherwise ship red.
  assert.ok(dockedTarget);
  assert.deepEqual(
    overBudget([measureTarget(dockedTarget, await dockedSource())]),
    []
  );
});

// ---- the decision the gate makes -------------------------------------------
//
// `overBudget` is the line CI fails on, so these run it rather than a
// re-statement of it: `check-bundle-budgets.mjs` calls it and only formats what
// comes back.

test('reports a target whose budgeted subset is over, whatever it ships', () => {
  assert.deepEqual(
    overBudget([
      {
        name: '@playdeck/react/theme.css',
        budget: 2.5,
        size: 2.0,
        budgeted: { label: 'CSS rules', size: 3.0 }
      }
    ]),
    [
      {
        name: '@playdeck/react/theme.css (CSS rules)',
        size: 3.0,
        budget: 2.5
      }
    ]
  );
});

test('does not report a target whose shipped size is over but whose subset is not', () => {
  // The regression that matters: measure the whole file here and the theme
  // fails on prose again, which is the failure #453 exists to end.
  assert.deepEqual(
    overBudget([
      {
        name: '@playdeck/react/theme.css',
        budget: 2.5,
        size: 5.79,
        budgeted: { label: 'CSS rules', size: 1.77 }
      }
    ]),
    []
  );
});

test('gates a target without a subset on the whole file, and ignores a null budget', () => {
  assert.deepEqual(
    overBudget([
      { name: '@playdeck/core', budget: 10, size: 10.5, budgeted: null },
      { name: '@playdeck/react', budget: 18, size: 16.9, budgeted: null },
      {
        name: '@playdeck/provider-hls',
        budget: null,
        size: 999,
        budgeted: null
      }
    ]),
    [{ name: '@playdeck/core', size: 10.5, budget: 10 }]
  );
});

test('a substantial comment block does not push the theme over its budget', async () => {
  // The defect this whole change exists for: #415 added about 2 KB of prose and
  // 0.07 KB of rules, and the gate failed it. Synthetic rather than a real edit
  // to the stylesheet, because the point is the decision, not the file.
  assert.ok(themeTarget);
  const prose = `/*\n${'A sentence of durable rationale that a reviewer asked for.\n'.repeat(200)}*/\n`;
  const measured = measureTarget(themeTarget, (await themeSource()) + prose);
  assert.ok(
    themeTarget.budget !== null && measured.size > themeTarget.budget,
    'the added prose is large enough to matter'
  );
  assert.deepEqual(overBudget([measured]), []);
});

test('a substantial rule block does push the theme over its budget', async () => {
  // The other direction, and the reason the gate is worth keeping at all: the
  // ceiling still has to fail on CSS the theme did not have before.
  assert.ok(themeTarget);
  const added = Array.from(
    { length: 400 },
    (_, index) =>
      `.playdeck-synthetic-${index} { padding-inline: ${index}px; border-radius: ${index % 7}px; }`
  ).join('\n');
  const measured = measureTarget(themeTarget, (await themeSource()) + added);
  assert.equal(overBudget([measured]).length, 1);
});
