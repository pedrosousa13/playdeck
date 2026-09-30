import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath, URL } from 'node:url';

import {
  evaluateHeaders,
  missingHeaders,
  parseHeaders,
  REQUIRED_HEADERS
} from './check-deploy-artifact.mjs';

// ---- parseHeaders ------------------------------------------------------------
//
// The same subset `loadRedirects` already uses for `_redirects`: blank lines
// and `#` comments are skipped, an unindented line starts a rule, and every
// indented `Name: Value` line under it belongs to that rule.

test('parses one rule with one header', () => {
  const text = '/*\n  X-Content-Type-Options: nosniff\n';
  assert.deepEqual(parseHeaders(text), [
    {
      path: '/*',
      headers: [{ name: 'X-Content-Type-Options', value: 'nosniff' }]
    }
  ]);
});

test('parses several headers under one rule, in order', () => {
  const text = [
    '/*',
    '  X-Frame-Options: SAMEORIGIN',
    '  Referrer-Policy: strict-origin-when-cross-origin'
  ].join('\n');
  assert.deepEqual(parseHeaders(text), [
    {
      path: '/*',
      headers: [
        { name: 'X-Frame-Options', value: 'SAMEORIGIN' },
        { name: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' }
      ]
    }
  ]);
});

test('skips a blank line and a # comment line', () => {
  const text = [
    '# comment',
    '',
    '/*',
    '  X-Content-Type-Options: nosniff'
  ].join('\n');
  assert.deepEqual(parseHeaders(text), [
    {
      path: '/*',
      headers: [{ name: 'X-Content-Type-Options', value: 'nosniff' }]
    }
  ]);
});

test('a value carrying a colon keeps the rest after the first colon', () => {
  const text = "/*\n  Content-Security-Policy: frame-ancestors 'self'";
  assert.deepEqual(parseHeaders(text), [
    {
      path: '/*',
      headers: [
        { name: 'Content-Security-Policy', value: "frame-ancestors 'self'" }
      ]
    }
  ]);
});

test('parses two separate rules', () => {
  const text = ['/*', '  X: 1', '/only-here', '  Y: 2'].join('\n');
  assert.deepEqual(parseHeaders(text), [
    { path: '/*', headers: [{ name: 'X', value: '1' }] },
    { path: '/only-here', headers: [{ name: 'Y', value: '2' }] }
  ]);
});

test('reads no rules from an empty file', () => {
  assert.deepEqual(parseHeaders(''), []);
});

// ---- missingHeaders ----------------------------------------------------------

test('reports nothing missing when every required header is present with the exact value', () => {
  assert.deepEqual(missingHeaders(REQUIRED_HEADERS), []);
});

test('names a header whose value does not match, case-sensitively', () => {
  const headers = REQUIRED_HEADERS.map((h) =>
    h.name === 'X-Frame-Options' ? { name: h.name, value: 'sameorigin' } : h
  );
  assert.deepEqual(missingHeaders(headers), ['X-Frame-Options']);
});

test('matches a header name case-insensitively', () => {
  const headers = REQUIRED_HEADERS.map((h) =>
    h.name === 'Referrer-Policy'
      ? { name: 'referrer-policy', value: h.value }
      : h
  );
  assert.deepEqual(missingHeaders(headers), []);
});

test('names every header missing at once, not just the first', () => {
  assert.deepEqual(
    missingHeaders([]),
    REQUIRED_HEADERS.map((h) => h.name)
  );
});

// ---- evaluateHeaders -----------------------------------------------------------
//
// The whole of what `check-deploy-artifact.mjs` runs against the artifact: a
// missing file, a missing `/*` rule, or a `/*` rule missing one of the five
// headers, are all failures a reader can name.

const completeHeadersFile = [
  '/*',
  '  X-Content-Type-Options: nosniff',
  '  X-Frame-Options: SAMEORIGIN',
  "  Content-Security-Policy: frame-ancestors 'self'",
  '  Strict-Transport-Security: max-age=31536000',
  '  Referrer-Policy: strict-origin-when-cross-origin'
].join('\n');

test('passes when every required header is on the /* rule', () => {
  assert.deepEqual(evaluateHeaders(completeHeadersFile), []);
});

test('fails when the file is missing (null text)', () => {
  const problems = evaluateHeaders(null);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /missing/i);
});

test('fails when there is no /* rule at all', () => {
  const text = '/only-here\n  X-Content-Type-Options: nosniff';
  const problems = evaluateHeaders(text);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /\/\*/);
});

for (const required of REQUIRED_HEADERS) {
  test(`fails, naming ${required.name}, when that header is removed`, () => {
    const withoutIt = completeHeadersFile
      .split('\n')
      .filter((line) => !line.trim().startsWith(`${required.name}:`))
      .join('\n');
    const problems = evaluateHeaders(withoutIt);
    assert.equal(problems.length, 1);
    assert.match(problems[0], new RegExp(required.name));
  });
}

// ---- the committed apps/site/public/_headers ---------------------------------
//
// Every test above hands evaluateHeaders a synthetic fixture, so none of them
// notice if the real file this repository ships drifts from #758's five
// headers, or is deleted outright — `pnpm test:deploy` would catch that, but
// it is on-demand rather than a pull-request gate. This reads the committed
// file straight off disk, relative to this test file rather than to whatever
// directory `node --test` was launched from, so `evaluateHeaders` is asked
// the same question about the file that ships as it is about every fixture
// above.

test('the committed apps/site/public/_headers carries every required header on /*', async () => {
  const path = fileURLToPath(
    new URL('../apps/site/public/_headers', import.meta.url)
  );
  const text = await readFile(path, 'utf8').catch(() => null);
  assert.deepEqual(evaluateHeaders(text), []);
});
