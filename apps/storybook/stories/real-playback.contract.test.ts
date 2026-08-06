import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Scans real-playback story source files: any story module tagged
// 'real-playback' must also be tagged '!test' so it never enters the
// zero-network addon-vitest suite. Source-level scan keeps this runnable in
// the root (node) suite without importing story runtimes. The file list is
// globbed (not hardcoded) so a newly added real-playback story can't slip
// past this check by being forgotten here.
const storiesDir = dirname(fileURLToPath(import.meta.url));

// Recursive, matching the `stories/**/*.stories.tsx` glob Storybook itself
// loads. A flat scan would quietly exempt every story in a subdirectory from
// the tag rule below, which is the opposite of what a guard is for.
const storyFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return storyFiles(path);
    return entry.name.endsWith('.stories.tsx') ? [path] : [];
  });

const allStoryFiles = storyFiles(storiesDir);
const realPlaybackStoryFiles = allStoryFiles.filter((path) =>
  readFileSync(path, 'utf8').includes("'real-playback'")
);

describe('real-playback stories opt out of the deterministic suite', () => {
  it('discovers at least one real-playback story file', () => {
    // Guards against a vacuous pass if the glob or tag string ever breaks.
    expect(realPlaybackStoryFiles.length).toBeGreaterThan(0);
  });

  it('scans story subdirectories, not just the top level', () => {
    // The tag rule is only as good as this file list.
    expect(
      allStoryFiles.filter((path) => relative(storiesDir, path).includes(sep))
    ).not.toEqual([]);
  });

  it('every real-playback story file also declares the !test tag', () => {
    for (const path of realPlaybackStoryFiles) {
      expect(
        readFileSync(path, 'utf8').includes("'!test'"),
        `${relative(storiesDir, path)} tags 'real-playback' but is missing '!test'`
      ).toBe(true);
    }
  });
});
