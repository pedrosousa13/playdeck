import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseParityMatrix,
  resolveParityPairs,
  type ParityRow
} from './parity-matrix';
import type { StoryIndexEntry } from './story-index';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOC_PATH = join(__dirname, '../../docs/backpack-parity.md');
const realMarkdown = readFileSync(DOC_PATH, 'utf-8');

// Pins the matrix's own counts line (docs/backpack-parity.md:15). A row added
// to one of the three story tables without updating that line is exactly the
// drift this is meant to catch, so this is the one test in the repo that
// breaks when someone does that.
test('parses every row of the real matrix and matches its declared counts', () => {
  const rows = parseParityMatrix(realMarkdown);

  expect(rows).toHaveLength(38);
  expect(rows.filter((row) => row.status === 'full')).toHaveLength(34);
  expect(rows.filter((row) => row.status === 'partial')).toHaveLength(4);
  expect(rows.filter((row) => row.status === 'gap')).toHaveLength(0);
});

test('parses a single-suite row with its Backpack title derived from the section', () => {
  const rows = parseParityMatrix(realMarkdown);
  const defaultRow = rows.find(
    (row) =>
      row.section === 'Video.stories.tsx' && row.backpackStoryName === 'Default'
  );

  expect(defaultRow).toMatchObject({
    backpackTitle: 'Components/Video/Video',
    status: 'full',
    reelyStories: [{ title: 'Backpack parity/Mock/Video', name: 'Default' }]
  });
});

test('parses a row whose Reely cell names both the Mock and the Real suite', () => {
  const rows = parseParityMatrix(realMarkdown);
  const row = rows.find(
    (r) =>
      r.section === 'Video.stories.tsx' &&
      r.backpackStoryName === 'WithoutHoverEffect'
  );

  expect(row?.reelyStories).toEqual([
    { title: 'Backpack parity/Mock/Video', name: 'WithoutHoverEffect' },
    { title: 'Backpack parity/Real/Video', name: 'WithoutHoverEffect' }
  ]);
});

test("throws when a table's row count disagrees with the counts line", () => {
  const malformed = `
Counts: 1 rows — 1 \`full\`, 0 \`partial\`, 0 \`gap\`.

## Video.stories.tsx

| Backpack story | Reely story | Status | Notes |
| --- | --- | --- | --- |
| \`Default\` | \`Backpack parity/Mock/Video → Default\` | \`full\` | n/a |
| \`Second\` | \`Backpack parity/Mock/Video → Second\` | \`full\` | n/a |
`;

  expect(() => parseParityMatrix(malformed)).toThrow(/counts/i);
});

const backpackIndex: StoryIndexEntry[] = [
  {
    id: 'components-video-video--default',
    title: 'Components/Video/Video',
    name: 'Default'
  }
];
const reelyIndex: StoryIndexEntry[] = [
  {
    id: 'backpack-parity-mock-video--default',
    title: 'Backpack parity/Mock/Video',
    name: 'Default'
  }
];

const row: ParityRow = {
  section: 'Video.stories.tsx',
  backpackTitle: 'Components/Video/Video',
  backpackStoryName: 'Default',
  reelyStories: [{ title: 'Backpack parity/Mock/Video', name: 'Default' }],
  status: 'full'
};

test("resolves a row to both sides' story ids when both index documents carry it", () => {
  const result = resolveParityPairs([row], backpackIndex, reelyIndex);

  expect(result.unresolved).toEqual([]);
  expect(result.resolved).toEqual([
    {
      row,
      backpackId: 'components-video-video--default',
      reelyIds: ['backpack-parity-mock-video--default']
    }
  ]);
});

test('reports every unresolved name together rather than stopping at the first', () => {
  const driftedRow: ParityRow = {
    ...row,
    backpackStoryName: 'NoLongerThere',
    reelyStories: [{ title: 'Backpack parity/Mock/Video', name: 'AlsoMissing' }]
  };

  const result = resolveParityPairs([driftedRow], backpackIndex, reelyIndex);

  expect(result.resolved).toEqual([]);
  expect(result.unresolved).toHaveLength(2);
});

test("matches a story name loosely across spacing and case, the way Storybook's own auto-title does", () => {
  // The matrix records `WithShadowVariant` (the export identifier); Storybook
  // renders that as "With Shadow Variant" in `/index.json` unless the story
  // overrides its own name. Confirmed against both live dev servers before
  // writing this (docs/backpack-parity.md's Video table, `WithShadowVariant`
  // row) — the resolver has to bridge that gap or every unrenamed story in
  // the matrix reports as unresolved.
  const spacedIndex: StoryIndexEntry[] = [
    { id: 'x--y', title: 'Components/Video/Video', name: 'With Shadow Variant' }
  ];
  const spacedRow: ParityRow = {
    ...row,
    backpackStoryName: 'WithShadowVariant',
    reelyStories: []
  };

  const result = resolveParityPairs([spacedRow], spacedIndex, []);

  expect(result.unresolved).toEqual([]);
  expect(result.resolved[0]?.backpackId).toBe('x--y');
});
