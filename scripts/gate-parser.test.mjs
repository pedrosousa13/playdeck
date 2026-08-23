import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, URL } from 'node:url';

const process = globalThis.process;
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

/**
 * Import the parser module in a child process and parse one document with it.
 *
 * A child rather than a direct import, because what is under test is a check
 * that runs once while the module is evaluated, against an environment variable
 * read at that moment. This process has already imported the module by the time
 * any test body runs, and a module is evaluated once per process, so the check
 * cannot be re-run in here at all.
 *
 * `undefined` means the variable is absent -- the developer's path -- rather
 * than present and empty.
 * @param {string | undefined} gateModules
 */
const importParser = (gateModules) => {
  const env = { ...process.env };
  delete env.PLAYDECK_GATE_MODULES;
  if (gateModules !== undefined) env.PLAYDECK_GATE_MODULES = gateModules;
  return spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "import { parse } from './scripts/gate-parser.mjs';" +
        "process.stdout.write(String(parse('gate: pinned').gate));"
    ],
    { cwd: repoRoot, encoding: 'utf8', env }
  );
};

test("parses with the tree's own parser when no runtime is named", () => {
  // What `pnpm test:audit` and `pnpm test:packages` do on a developer machine,
  // and what CI's second, unpinned run of each gate does. There is no `.gate/`
  // to resolve from and nothing to assert about; the check must stay out of the
  // way rather than fail closed on a run that was never pinned.
  const result = importParser(undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'pinned');
});

test('accepts a parser resolved from inside the named runtime', () => {
  // The CI arrangement in miniature: the directory the parser really did
  // resolve from is named, so the check passes and the parse happens. pnpm
  // links `node_modules/yaml` into `node_modules/.pnpm`, and Node resolves
  // symlinks while resolving a module, so this also covers the realpath'd
  // comparison -- both paths stay under the named directory.
  const result = importParser(join(repoRoot, 'node_modules'));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'pinned');
});

test('refuses a parser resolved outside the named runtime', (t) => {
  // The defect this exists for: a pinned gate that resolved the tree's copy
  // after all -- the install skipped, the extraction landing somewhere else,
  // the pull request's own `node_modules` reached first. Failing loudly is the
  // whole point, since the alternative is a gate that runs pull-request code
  // and says nothing.
  const elsewhere = mkdtempSync(join(tmpdir(), 'playdeck-gate-modules-'));
  t.after(() => rmSync(elsewhere, { recursive: true, force: true }));
  const result = importParser(elsewhere);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /not inside the runtime installed for the gate/);
  // Named, both of them: an operator reading a red step needs to see which
  // directory answered and which one should have.
  assert.match(result.stderr, /node_modules/);
  assert.ok(result.stderr.includes(elsewhere), result.stderr);
});

test('refuses a runtime directory that is not there at all', () => {
  // An install that did not happen must not read as "nothing to check". Same
  // rule `PLAYDECK_PUBLISHABLE_BASELINE` follows in scripts/audit.mjs: set
  // means mandatory, and a gate that skips itself when its own input is
  // missing is a bypass.
  const result = importParser(join(repoRoot, 'this-directory-does-not-exist'));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /ENOENT/);
});
