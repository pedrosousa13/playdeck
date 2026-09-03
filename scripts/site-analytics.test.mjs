import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const analyticsScript =
  '<script defer data-domain="playdeck.video" src="https://analytics.pedrosousa.me/js/script.js"></script>';

const buildSite = (outDir, environment) => {
  execFileSync(
    'pnpm',
    [
      '--filter',
      '@playdeck/site',
      'exec',
      'astro',
      'build',
      '--outDir',
      outDir
    ],
    {
      cwd: repoRoot,
      env: { ...process.env, ASTRO_TELEMETRY_DISABLED: '1', ...environment },
      stdio: 'inherit'
    }
  );
};

test('emits the Plausible script only in a production-tracking build', () => {
  const directory = mkdtempSync(join(tmpdir(), 'playdeck-site-analytics-'));
  try {
    const withoutAnalytics = join(directory, 'without-analytics');
    buildSite(withoutAnalytics, {});
    assert.doesNotMatch(
      readFileSync(join(withoutAnalytics, 'index.html'), 'utf8'),
      /analytics\.pedrosousa\.me/
    );

    const withAnalytics = join(directory, 'with-analytics');
    buildSite(withAnalytics, { PUBLIC_PLAUSIBLE_ANALYTICS: 'true' });
    assert.match(
      readFileSync(join(withAnalytics, 'index.html'), 'utf8'),
      new RegExp(analyticsScript.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
