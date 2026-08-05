import { expect, test } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveBackpackDir } from './backpack-dir';

// The default path is a fact this plan verified by hand (see
// docs/superpowers/plans/2026-08-05-backpack-storybook-comparison-harness-211-plan.md,
// "Facts verified before this plan was written"), so a directory that exists
// there is not itself a claim this suite re-derives.
const DEFAULT_DIR = '/Users/pedrosousa/Documents/apps/backpack/beta';

test('falls back to the known Backpack checkout when no override is set', () => {
  expect(resolveBackpackDir({})).toBe(DEFAULT_DIR);
});

test('honours REELY_BACKPACK_DIR when it points at a real directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'reely-backpack-dir-'));
  try {
    expect(resolveBackpackDir({ REELY_BACKPACK_DIR: dir })).toBe(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('fails with one sentence naming the variable and the expected version when the directory is missing', () => {
  const missing = join(tmpdir(), 'reely-backpack-dir-does-not-exist');
  expect(() => resolveBackpackDir({ REELY_BACKPACK_DIR: missing })).toThrow(
    /REELY_BACKPACK_DIR/
  );
  expect(() => resolveBackpackDir({ REELY_BACKPACK_DIR: missing })).toThrow(
    /v4 beta/
  );
});
