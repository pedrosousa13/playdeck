import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath, URL } from 'node:url';
import { selectPublishable, workspaceProjects } from './workspace-packages.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

test('keeps the workspace projects that are not private', () => {
  assert.deepEqual(
    selectPublishable([
      { name: 'playdeck', path: '/w', private: true },
      {
        name: '@playdeck/core',
        version: '0.0.0',
        path: '/w/packages/core',
        private: false
      },
      { name: '@playdeck/storybook', path: '/w/apps/storybook', private: true }
    ]).map((entry) => entry.name),
    ['@playdeck/core']
  );
});

// selectPublishable reads one field of pnpm's output, and both gates that
// depend on it would go quiet rather than red if `pnpm list -r` stopped
// reporting that field. Only a real invocation can catch that, so run one.
test('discovers this workspace with the field the rule turns on', () => {
  const projects = workspaceProjects(repoRoot);
  assert.ok(projects.length > 1);
  for (const project of projects) {
    assert.equal(typeof project.name, 'string', JSON.stringify(project));
    assert.equal(typeof project.private, 'boolean', JSON.stringify(project));
  }
  // The root is a project too, and it is never publishable.
  assert.deepEqual(
    projects.find((project) => project.path === repoRoot.replace(/\/$/, ''))
      ?.private,
    true
  );
  // Every publishable package carries the version npm needs to accept it.
  for (const pkg of selectPublishable(projects)) {
    assert.match(pkg.version, /^\d+\.\d+\.\d+/, pkg.name);
  }
});

test('refuses a listing with nothing publishable in it', () => {
  // An empty result is never a legitimate answer here: it means the discovery
  // command changed shape, and every caller would then silently check nothing.
  assert.throws(
    () => selectPublishable([{ name: 'playdeck', path: '/w', private: true }]),
    /No publishable workspace packages were discovered/
  );
});
