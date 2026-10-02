import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  changesetProblems,
  pendingChangesetProblems
} from './check-changesets.mjs';

/**
 * A fresh directory under the OS temp dir, holding whatever `.changeset`
 * files a test needs -- cleaned up after the test runs.
 * @param {import('node:test').TestContext} t
 * @returns {string}
 */
const changesetDir = (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'playdeck-check-changesets-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

test('reports a line that narrates history, naming the file, line and word', (t) => {
  const dir = changesetDir(t);
  writeFileSync(
    join(dir, 'a-changeset.md'),
    "---\n'@playdeck/core': patch\n---\n\nThe provider now retries once.\n"
  );
  assert.deepEqual(pendingChangesetProblems(dir), [
    { file: 'a-changeset.md', line: 5, word: 'now' }
  ]);
});

test('passes a changeset whose prose does not narrate history', (t) => {
  const dir = changesetDir(t);
  writeFileSync(
    join(dir, 'clean.md'),
    "---\n'@playdeck/core': patch\n---\n\nThe provider retries once.\n"
  );
  assert.deepEqual(pendingChangesetProblems(dir), []);
});

test('ignores the front matter, reading only the prose after it', (t) => {
  const dir = changesetDir(t);
  writeFileSync(
    join(dir, 'frontmatter-only.md'),
    // The bump line is not prose, and never narrates anything -- this
    // asserts a literal "now" sitting inside it is not read as one.
    "---\n'@playdeck/now-package': patch\n---\n\nThe provider retries once.\n"
  );
  assert.deepEqual(pendingChangesetProblems(dir), []);
});

test('skips README.md and config.json', (t) => {
  const dir = changesetDir(t);
  writeFileSync(join(dir, 'README.md'), 'This is now documented here.\n');
  writeFileSync(join(dir, 'config.json'), '{ "note": "now configured" }\n');
  assert.deepEqual(pendingChangesetProblems(dir), []);
});

test('passes an empty directory', (t) => {
  const dir = changesetDir(t);
  assert.deepEqual(pendingChangesetProblems(dir), []);
});

test('does not match a word merely containing "now"', () => {
  assert.deepEqual(
    changesetProblems('The cache is known to clear on snowy days.\n'),
    []
  );
});

test('matches every phrase the rule exists to catch, case-insensitively', () => {
  assert.deepEqual(
    changesetProblems('Previously this threw.\nAs before, nothing changes.\n'),
    [
      { line: 1, word: 'Previously' },
      { line: 2, word: 'As before' }
    ]
  );
});

// "used to" also reads as present tense -- "this option is used to configure
// retries" describes what the option does today, not what it used to do --
// so it is deliberately not one of the phrases this rule catches.
test('passes prose using "used to" in its present-tense sense', () => {
  assert.deepEqual(
    changesetProblems('This option is used to configure retries.\n'),
    []
  );
});
