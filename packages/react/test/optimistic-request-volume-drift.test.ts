// @vitest-environment node
// `optimistic-request-volume.ts` is a deliberate duplicate of
// `optimistic-request.ts` (both files' own headers say why: a module reached
// both statically, by SeekSlider, and dynamically, by volume-request.ts,
// is exactly what a bundler factors into its own extra chunk, costing every
// page with a SeekSlider a sixth eager request). The two headers are meant
// to differ -- each names the other file -- but everything below the
// `---- identical with its sibling copy below this line ----` marker both
// files carry is supposed to be the same source, verbatim. This is the test
// that makes that an enforced fact rather than a comment's claim.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const MARKER = '---- identical with its sibling copy below this line ----';

// The shared portion of a file carrying the marker: everything strictly
// after the marker's own line, so the marker line itself (identical in both
// files already) and each file's own differing header above it play no part
// in the comparison.
const sharedPortion = (path: string): string => {
  const source = readFileSync(path, 'utf8');
  const markerLine = source
    .split('\n')
    .findIndex((line) => line.includes(MARKER));
  if (markerLine === -1) {
    throw new Error(`${path} is missing the "${MARKER}" marker.`);
  }
  return source
    .split('\n')
    .slice(markerLine + 1)
    .join('\n');
};

describe('optimistic-request-volume.ts', () => {
  test('stays byte-identical to optimistic-request.ts past each file’s own header', () => {
    const original = sharedPortion(
      fileURLToPath(new URL('../src/optimistic-request.ts', import.meta.url))
    );
    const copy = sharedPortion(
      fileURLToPath(
        new URL('../src/optimistic-request-volume.ts', import.meta.url)
      )
    );
    expect(copy).toBe(original);
  });
});
