import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, URL } from 'node:url';
import {
  resolutionModes,
  resolutionProblems,
  supportedResolutionModes
} from './resolution-modes.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const packageNames = ['@playdeck/core', '@playdeck/react'];

// Read out of the table rather than written down here, so the tests keep asking
// about whichever modes carry the mark, however many that is.
const unsupportedModes = Object.keys(resolutionModes).filter(
  (mode) => resolutionModes[mode].unsupported
);
if (unsupportedModes.length === 0) {
  throw new Error(
    'No mode in scripts/resolution-modes.mjs is marked unsupported, so nothing here checks the half of the gate that watches for one starting to work.'
  );
}

const legacyDiagnostic = packageNames
  .map(
    (name) =>
      `src/publishable-packages.ts(1,21): error TS2307: Cannot find module '${name}' or its corresponding type declarations.\n` +
      `  There are types at '/tmp/f/node_modules/${name}/dist/index.d.ts', but this result could not be resolved under your current 'moduleResolution' setting. Consider updating to 'node16', 'nodenext', or 'bundler'.\n`
  )
  .join('');

/**
 * A run in which every mode did what it is supposed to do, which the tests
 * below then damage one mode at a time.
 * @returns {Record<string, { status: number; output: string }>}
 */
const cleanRun = () =>
  Object.fromEntries(
    Object.entries(resolutionModes).map(([mode, { unsupported }]) => [
      mode,
      unsupported
        ? { status: 2, output: legacyDiagnostic }
        : { status: 0, output: '' }
    ])
  );

test('a run in which every mode behaved reports nothing', () => {
  assert.deepEqual(resolutionProblems(packageNames, cleanRun()), []);
});

test('a supported mode that no longer type-checks is reported', () => {
  for (const mode of Object.keys(supportedResolutionModes)) {
    const results = cleanRun();
    results[mode] = {
      status: 2,
      output: "error TS2307: Cannot find module '@playdeck/react'."
    };
    const problems = resolutionProblems(packageNames, results);
    assert.equal(problems.length, 1, mode);
    assert.match(problems[0], new RegExp(`^${mode} `));
  }
});

// The half of this that a "supported modes pass" check cannot give: an
// unsupported mode is unsupported on purpose, so it starting to work is a
// change nobody asked for and nothing else would notice.
test('an unsupported mode type-checking clean is reported', () => {
  for (const mode of unsupportedModes) {
    const results = cleanRun();
    results[mode] = { status: 0, output: '' };
    const problems = resolutionProblems(packageNames, results);
    assert.equal(problems.length, 1, mode);
    assert.match(problems[0], new RegExp(`^${mode} `));
  }
});

// A non-zero exit is not the assertion. The compiler refuses `moduleResolution`
// settings it is retiring before it resolves anything, so a mode configured
// without the acknowledgement that silences that refusal exits non-zero having
// never looked at a package -- which would prove nothing while reading green.
test('an unsupported mode failing before it resolved anything is reported', () => {
  for (const mode of unsupportedModes) {
    const results = cleanRun();
    results[mode] = {
      status: 2,
      output:
        "tsconfig.json(1,149): error TS5107: Option 'moduleResolution=node10' is deprecated and will stop functioning in TypeScript 7.0.\n"
    };
    // One per package: none of them was reported as resolvable-but-unreachable.
    assert.equal(
      resolutionProblems(packageNames, results).length,
      packageNames.length,
      mode
    );
  }
});

test('a package missing from the legacy diagnostic is reported', () => {
  for (const mode of unsupportedModes) {
    const results = cleanRun();
    results[mode] = {
      status: 2,
      output: legacyDiagnostic.split('\n').slice(0, 2).join('\n')
    };
    const problems = resolutionProblems(packageNames, results);
    assert.equal(problems.length, 1, mode);
    assert.match(problems[0], /@playdeck\/react/);
  }
});

// A mode the caller never ran is not a mode that passed. Without this the
// table could gain an entry and the harness could skip it silently.
test('a mode with no result at all is reported', () => {
  const results = cleanRun();
  const mode = Object.keys(resolutionModes)[0];
  delete results[mode];
  const problems = resolutionProblems(packageNames, results);
  assert.equal(problems.length, 1);
  assert.match(problems[0], new RegExp(`^${mode} `));
});

// What keeps "an edit here and nowhere else" true. The fixture's tsconfig is
// the consumer configuration every mode above is checked under, and the harness
// supplies the mode by generating a config that extends it -- so a `module` or
// `moduleResolution` in the base is a second copy of a row of this table, and
// an inert one, since the generated config overrides it. It landed that way,
// byte-identical to the `bundler` row, and nothing noticed.
//
// Read with the compiler's own parser rather than `JSON.parse`, because a
// tsconfig may carry comments and that file does.
test('the fixture selects no resolution mode of its own', async () => {
  const path = 'tests/packaging/fixture/tsconfig.json';
  const { default: ts } = await import('typescript');
  const { config, error } = ts.parseConfigFileTextToJson(
    path,
    readFileSync(join(repoRoot, path), 'utf8')
  );
  assert.equal(
    error,
    undefined,
    error ? ts.flattenDiagnosticMessageText(error.messageText, '\n') : ''
  );
  const compilerOptions = /** @type {Record<string, unknown>} */ (
    config?.compilerOptions ?? {}
  );

  for (const option of ['module', 'moduleResolution']) {
    assert.equal(
      compilerOptions[option],
      undefined,
      `${path} sets \`${option}\`. That is what scripts/resolution-modes.mjs is for: every run overrides it, so the value there is dead, and retiring a mode from the table would leave a copy of it behind.`
    );
  }
});
