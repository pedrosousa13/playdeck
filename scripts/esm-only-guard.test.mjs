import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, URL } from 'node:url';
import { guardProblems, guardRuntime, guardTypes } from './esm-only-guard.mjs';
import { publishablePackages } from './workspace-packages.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const packages = publishablePackages(repoRoot);

/**
 * A consumer's `node_modules` holding every publishable package as it would
 * arrive from the registry: the real manifest, the real guard files, and a
 * stub behind the `import` condition.
 *
 * The stub is what lets this run without a build, and it costs nothing the
 * tests below need: what is under test is which file each resolution mode
 * reaches through the export map, not what that file declares.
 * @param {import('node:test').TestContext} t
 */
const installedTree = (t) => {
  const root = mkdtempSync(join(tmpdir(), 'playdeck-esm-only-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const pkg of packages) {
    const installed = join(root, 'node_modules', pkg.name);
    mkdirSync(join(installed, 'dist'), { recursive: true });
    for (const file of ['package.json', guardTypes, guardRuntime]) {
      cpSync(join(pkg.path, file), join(installed, file));
    }
    writeFileSync(
      join(installed, 'dist/index.d.ts'),
      'export declare const version: string;\n'
    );
    writeFileSync(
      join(installed, 'dist/index.js'),
      "export const version = '0.0.0';\n"
    );
  }
  return root;
};

// Every package imported by name, from one file, so one compiler run reports
// on all of them and a package that lost the guard cannot hide behind a
// sibling that still has it.
const consumerSource = packages
  .map((pkg, index) => `import { version as v${index} } from '${pkg.name}';\n`)
  .join('');

/**
 * Type-checks the consumer above under one resolution mode and returns what
 * the compiler said.
 * @param {string} root
 * @param {string} mode
 * @param {{ type?: 'module'; compilerOptions: Record<string, string> }} setup
 */
const typecheck = (root, mode, setup) => {
  const dir = join(root, mode);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({
      name: `consumer-${mode}`,
      private: true,
      version: '0.0.0',
      ...(setup.type ? { type: setup.type } : {})
    })
  );
  writeFileSync(
    join(dir, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        lib: ['ES2022', 'DOM'],
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        ...setup.compilerOptions
      },
      files: ['consumer.ts']
    })
  );
  writeFileSync(join(dir, 'consumer.ts'), consumerSource);

  try {
    execFileSync(
      join(repoRoot, 'node_modules/.bin/tsc'),
      ['-p', join(dir, 'tsconfig.json')],
      { encoding: 'utf8' }
    );
    return { status: 0, output: '' };
  } catch (error) {
    const failed = /** @type {{ status: number; stdout: string }} */ (
      /** @type {unknown} */ (error)
    );
    return { status: failed.status, output: failed.stdout };
  }
};

test('every publishable package carries the ESM-only guard', () => {
  for (const pkg of packages) {
    const manifest = JSON.parse(
      readFileSync(join(pkg.path, 'package.json'), 'utf8')
    );
    assert.deepEqual(
      guardProblems(manifest, (entry) => {
        try {
          return readFileSync(join(pkg.path, entry), 'utf8');
        } catch {
          return undefined;
        }
      }),
      [],
      pkg.name
    );
  }
});

// The defect this guard exists for: a CommonJS consumer used to get exit 0 and
// zero diagnostics here, then `ERR_PACKAGE_PATH_NOT_EXPORTED` from Node.
test('a CommonJS consumer is told at build time', (t) => {
  const root = installedTree(t);
  const { status, output } = typecheck(root, 'cjs-nodenext', {
    compilerOptions: { module: 'nodenext', moduleResolution: 'nodenext' }
  });
  assert.notEqual(status, 0, output);
  for (const pkg of packages) {
    assert.match(
      output,
      new RegExp(
        `${pkg.name.replace('/', '\\/')}\\/${guardTypes.replace('.', '\\.')}`
      ),
      `${pkg.name} did not send the consumer to the guard:\n${output}`
    );
  }
});

// The modes that already worked, each of which the guard has to leave alone. A
// guard that made any of them worse would be a bad trade: it would have moved
// the failure rather than surfaced it. `node10` is not among them and is not
// checked here -- that mode ignores export maps entirely, so nothing written
// into one can reach it.
for (const [mode, setup] of Object.entries({
  'esm-nodenext': {
    type: /** @type {'module'} */ ('module'),
    compilerOptions: { module: 'nodenext', moduleResolution: 'nodenext' }
  },
  'esm-node16': {
    type: /** @type {'module'} */ ('module'),
    compilerOptions: { module: 'node16', moduleResolution: 'node16' }
  },
  bundler: {
    compilerOptions: { module: 'esnext', moduleResolution: 'bundler' }
  }
})) {
  test(`${mode} resolves the real entry`, (t) => {
    const root = installedTree(t);
    const { status, output } = typecheck(root, mode, setup);
    assert.equal(status, 0, output);
  });
}

test('require() is refused by name rather than by missing export', (t) => {
  const root = installedTree(t);
  const require = createRequire(join(root, 'consumer.cjs'));
  for (const pkg of packages) {
    assert.match(require.resolve(pkg.name), new RegExp(`${guardRuntime}$`));
    assert.throws(() => require(pkg.name), {
      message: new RegExp(`^${pkg.name} is ESM only and cannot be loaded`)
    });
  }
});
