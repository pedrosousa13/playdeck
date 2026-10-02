import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';
import {
  driftProblems,
  EXCLUSIONS,
  STEPS,
  workflowPnpmInvocations
} from './verify.mjs';

// A small workflow carrying one of each shape .github/workflows/ci.yml's
// real jobs use -- a bare `&&` chain, a `--filter` call, an `exec` call, a
// non-pnpm multi-line step, and one script (`test:nonexistent`) that exists
// nowhere in STEPS or EXCLUSIONS -- so a single parse exercises every shape
// this module has to tell apart and supplies the drift case at the same time.
const fixtureWorkflow = `
jobs:
  example:
    runs-on: ubuntu-latest
    steps:
      - run: pnpm format:check && pnpm lint
      - run: pnpm --filter @playdeck/storybook build
      - run: pnpm exec turbo run build --filter=@playdeck/site...
      - run: pnpm test:nonexistent
      - run: echo hello
      - run: |
          git fetch --depth=1 origin main
          node .gate/audit.mjs
`;

test('reads a bare pnpm script out of a chained && step, args dropped', () => {
  assert.deepEqual(
    workflowPnpmInvocations(
      'jobs:\n  j:\n    steps:\n      - run: pnpm format:check && pnpm lint\n'
    ),
    [
      { form: 'script', script: 'format:check' },
      { form: 'script', script: 'lint' }
    ]
  );
});

test("reads a pnpm --filter call as the named package's own script", () => {
  assert.deepEqual(
    workflowPnpmInvocations(
      'jobs:\n  j:\n    steps:\n      - run: pnpm --filter @playdeck/storybook build\n'
    ),
    [{ form: 'filter', filter: '@playdeck/storybook', script: 'build' }]
  );
});

test('reads a pnpm exec call, keeping its whole trailing command', () => {
  assert.deepEqual(
    workflowPnpmInvocations(
      'jobs:\n  j:\n    steps:\n      - run: pnpm exec turbo run build --filter=@playdeck/site...\n'
    ),
    [{ form: 'exec', command: 'turbo run build --filter=@playdeck/site...' }]
  );
});

test('ignores a pnpm command quoted inside a comment, only reading run: text', () => {
  // Several of .github/workflows/ci.yml's own job comments quote a real
  // command for rationale -- "`pnpm test:audit` prints every advisory..." --
  // without that command ever running there. A parser that scanned the raw
  // file text rather than the parsed run: steps would read that quote as an
  // invocation; this fixture reproduces the shape with a name no step runs.
  const workflowYaml = [
    'jobs:',
    '  example:',
    '    steps:',
    '      # pnpm test:nonexistent is named here only in prose, never run',
    '      - run: pnpm build'
  ].join('\n');
  assert.deepEqual(workflowPnpmInvocations(workflowYaml), [
    { form: 'script', script: 'build' }
  ]);
});

test('reads every shape in one workflow, in document order', () => {
  assert.deepEqual(workflowPnpmInvocations(fixtureWorkflow), [
    { form: 'script', script: 'format:check' },
    { form: 'script', script: 'lint' },
    { form: 'filter', filter: '@playdeck/storybook', script: 'build' },
    { form: 'exec', command: 'turbo run build --filter=@playdeck/site...' },
    { form: 'script', script: 'test:nonexistent' }
  ]);
});

test('flags a pnpm script that is in neither the verify list nor the exclusion list', () => {
  assert.deepEqual(driftProblems(fixtureWorkflow, STEPS, EXCLUSIONS), [
    { form: 'script', script: 'test:nonexistent' }
  ]);
});

test('passes a step whose script is in STEPS and one whose script is in EXCLUSIONS', () => {
  const workflowYaml =
    'jobs:\n  j:\n    steps:\n      - run: pnpm install --frozen-lockfile\n      - run: pnpm build\n';
  assert.deepEqual(driftProblems(workflowYaml, STEPS, EXCLUSIONS), []);
});

// The one test that holds this rule against the real file rather than a
// fixture -- the drift check #871 exists for. Demonstrated red by removing
// the `build` entry from STEPS: driftProblems then reports
// `{ form: 'script', script: 'build' }`, recorded in the commit that adds
// this test.
test('finds no drift between the real ci.yml and the verify + exclusion lists', () => {
  const workflowYaml = readFileSync(
    new URL('../.github/workflows/ci.yml', import.meta.url),
    'utf8'
  );
  assert.deepEqual(driftProblems(workflowYaml, STEPS, EXCLUSIONS), []);
});

test('strips a leading env assignment before classifying the pnpm call', () => {
  assert.deepEqual(
    workflowPnpmInvocations(
      'jobs:\n  j:\n    steps:\n      - run: NODE_ENV=production pnpm test:new\n'
    ),
    [{ form: 'script', script: 'test:new' }]
  );
});

test('reads pnpm run <script> as the named script, not a script literally named run', () => {
  assert.deepEqual(
    workflowPnpmInvocations(
      'jobs:\n  j:\n    steps:\n      - run: pnpm run build\n'
    ),
    [{ form: 'script', script: 'build' }]
  );
});

test('reads an unclassifiable pnpm call as unrecognized and reports it as drift', () => {
  // `-r` is a pnpm flag, not a script name -- reading it as one would
  // silently misname a call that may not run a package.json script at all.
  const workflowYaml = 'jobs:\n  j:\n    steps:\n      - run: pnpm -r build\n';
  assert.deepEqual(workflowPnpmInvocations(workflowYaml), [
    { form: 'unrecognized', statement: 'pnpm -r build' }
  ]);
  assert.deepEqual(driftProblems(workflowYaml, STEPS, EXCLUSIONS), [
    { form: 'unrecognized', statement: 'pnpm -r build' }
  ]);
});

test('strips an env assignment on a line inside a multi-line run: block too', () => {
  const workflowYaml = [
    'jobs:',
    '  example:',
    '    steps:',
    '      - run: |',
    '          echo setup',
    '          NODE_ENV=production pnpm test:multiline-drift',
    '          node .gate/audit.mjs'
  ].join('\n');
  assert.deepEqual(driftProblems(workflowYaml, STEPS, EXCLUSIONS), [
    { form: 'script', script: 'test:multiline-drift' }
  ]);
});
