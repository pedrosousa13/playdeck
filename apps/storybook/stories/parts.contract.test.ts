// @vitest-environment node
// Reads two files off disk rather than rendering anything, and happy-dom's
// global `URL` cannot resolve `import.meta.url` into a file path.

import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { describe, expect, it } from 'vitest';

// The `data-reely-part` bullet in Contract.mdx reads as the catalogue of parts
// -- the section around it says to style and query against these attributes --
// and nothing checked it, so it drifted: the captions-rendering, settings-menu
// and gestures families landed as primitives and never reached the page (#178).
// A hand-maintained list of thirty-odd strings goes stale silently and prose
// cannot say otherwise; this can. Both sets are derived here, neither is
// written down -- a list in this file would just be the copy that drifts next.
//
// Not in `scripts/docs-examples.mjs`: that gate rewrites generated `example:`
// fences from the fixture a marker names, and this bullet is inline code inside
// a sentence with no fixture that could generate it, so the concern would ride
// along there as an unrelated passenger behind `pnpm docs:check` instead of
// `pnpm test`. The contract-test convention fits as it stands --
// `packages/react/test/theme.test.ts` is the structural precedent (node
// environment, `readFile` off disk, a regex over a source artifact, assert a
// list of offender sentences), and `vitest.config.ts` already collects
// `apps/storybook/stories/**/*.contract.test.ts`.

const reactSrcDir = fileURLToPath(
  new URL('../../../packages/react/src/', import.meta.url)
);

// Recursive and file-filtered: a subdirectory added under `src/` should be
// scanned, not handed to `readFile` as a path that throws EISDIR.
const sources = await Promise.all(
  (await readdir(reactSrcDir, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
    .map(async (entry) => {
      const path = join(entry.parentPath, entry.name);
      return {
        file: relative(reactSrcDir, path),
        source: await readFile(path, 'utf8')
      };
    })
);

const literalPart = /data-reely-part="([^"]+)"/g;

// Every part value the primitives emit.
const emitted = new Set(
  sources.flatMap(({ source }) =>
    [...source.matchAll(literalPart)].map(([, part]) => part)
  )
);

const page = await readFile(new URL('./Contract.mdx', import.meta.url), 'utf8');

// The documented set is the parenthesised run in the bullet, not every backtick
// in it: the sentences after the list name parts (`error-retry`) and primitives
// (`ErrorDisplay`) in the same backticks, so backticks alone would read a
// primitive's name as a part and let a real omission hide behind a mention.
const bullet = /^- \*\*`data-reely-part`\*\*[\s\S]*?(?=^- \*\*)/m.exec(
  page
)?.[0];
if (bullet === undefined) {
  throw new Error('Contract.mdx has no `data-reely-part` bullet to check.');
}
const list = /\(([^)]*)\)/.exec(bullet)?.[1];
if (list === undefined) {
  throw new Error(
    'The `data-reely-part` bullet names no parenthesised list of parts.'
  );
}
const documented = new Set(
  [...list.matchAll(/`([^`]+)`/g)].map(([, part]) => part)
);

describe('the data-reely-part list is the whole contract', () => {
  it('derives a non-empty set from each side', () => {
    // Guards against a vacuous pass if either derivation ever breaks: an empty
    // `emitted` makes "the page names every part" trivially true, and an empty
    // `documented` does the same for its converse.
    expect(
      emitted.size,
      'No parts were read out of packages/react/src -- the source scan broke, which says nothing about the contract.'
    ).toBeGreaterThan(0);
    expect(
      documented.size,
      'No parts were read out of the data-reely-part bullet in Contract.mdx -- the bullet or list regex broke, which says nothing about the contract.'
    ).toBeGreaterThan(0);
  });

  it('every part value in the source is a plain string literal', () => {
    // `emitted` can only read `data-reely-part="..."`, so rather than guess at
    // the ways an emission could be written instead, this counts. Every
    // occurrence of the string in the sources must be claimed by a
    // literal-attribute match, which catches the forms that would otherwise go
    // unread -- an object or spread (`{...{'data-reely-part': x}}`), a computed
    // JSX value. And a captured value holding `${` is an interpolated template
    // literal, which does match but names no part, so it is rejected too.
    //
    // Not covered: a part that reaches the DOM without the string appearing in
    // these files at all -- an attribute name assembled from fragments, or one
    // set from a package this scan does not read.
    const unreadable = sources.flatMap(({ file, source }) => {
      const occurrences = source.split('data-reely-part').length - 1;
      const literals = [...source.matchAll(literalPart)];
      return [
        ...(literals.length < occurrences
          ? [
              `packages/react/src/${file} writes data-reely-part ${occurrences - literals.length} time(s) in a form other than a string-literal attribute, which this gate cannot read.`
            ]
          : []),
        ...literals
          .filter(([, part]) => part.includes('${'))
          .map(
            ([, part]) =>
              `packages/react/src/${file} interpolates data-reely-part="${part}", which is a template literal rather than a part name.`
          )
      ];
    });
    expect(unreadable).toEqual([]);
  });

  it('the page names every part the primitives emit', () => {
    const undocumented = [...emitted]
      .filter((part) => !documented.has(part))
      .sort()
      .map(
        (part) =>
          `\`${part}\` is emitted by a primitive in packages/react/src but missing from the data-reely-part list in Contract.mdx.`
      );
    expect(undocumented).toEqual([]);
  });

  it('the page names no part the primitives do not emit', () => {
    // Worse than an omission: a documented selector that matches nothing gets a
    // consumer writing CSS against it and hearing silence back.
    const phantom = [...documented]
      .filter((part) => !emitted.has(part))
      .sort()
      .map(
        (part) =>
          `\`${part}\` is listed in the data-reely-part list in Contract.mdx but no primitive in packages/react/src emits it.`
      );
    expect(phantom).toEqual([]);
  });
});
