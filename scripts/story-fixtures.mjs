#!/usr/bin/env node
// The rule that a story addresses a fixture through `stories/asset-url.ts`
// rather than by a root-absolute literal. #435 is the record of why: the
// workbench is served from whatever `PLAYDECK_BASE_PATH` says, and a literal
// `/tracer.mp4` resolves outside that prefix, where nothing is served, so the
// story that carries one works at `/` and 404s everywhere else.
//
// What used to catch that was scripts/check-deploy-artifact.mjs, which built
// the workbench under a prefix and drove a browser through it. #534 stopped
// deploying the workbench, so that harness stopped building it and the check
// went with it (#583). This is the cheaper replacement the ADR asked for: no
// build and no browser, so it runs in the `static` job and cannot flake. It
// catches the authoring mistake directly rather than the 404 downstream, which
// also means it proves less — a prefixed build that works is still only shown
// by the two commands in apps/storybook/README.md.
//
// The judgement is separated from the IO the way scripts/client-boundary.mjs
// separates them: which literals are the defect is decided here and tested
// directly on hand-written sources, while the caller supplies the bytes and
// the fixture set.
//
// Which literals it reaches is read off the filesystem rather than off a list
// of names, because the alternative is an ignore list that grows every time a
// story addresses something legitimately root-absolute. A literal is this
// defect when the path it names is a file under apps/storybook/public: those
// are exactly the references that should have gone through the resolver.
// `stories/poster-image.stories.tsx` is what makes that scoping worth having —
// it addresses `/__playdeck__/pending.png` and `/__playdeck__/missing-poster.png`
// on purpose, being stories about a poster that never loads, and no fixture
// answers either, so the rule leaves them alone with nothing written down
// anywhere to say so.

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const console = globalThis.console;
const process = globalThis.process;
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

const STORIES = 'apps/storybook/stories';
const PUBLIC = 'apps/storybook/public';

/**
 * Every string literal in a source, with the line it opens on.
 *
 * A scan rather than a parse, and it tracks comments for one reason: the
 * places this repository explains the rule -- `stories/asset-url.ts`'s doc
 * comment, and the comment above the second resolver in
 * `stories/reference/reference-player.tsx` -- name the literal not to write. A
 * scan that read comments would fail on the files that document it. Tracking
 * them here rather than stripping them first also keeps a `//` inside a string
 * (`https://...`) from swallowing the rest of its line.
 *
 * A `${...}` inside a template literal is read as part of the string, so
 * `` `${assetUrl('poster.svg')} 640w` `` is one literal that starts with a
 * brace and is judged as such. That costs nothing: an interpolated path is not
 * root-absolute, which is the only shape the rule reports.
 * @param {string} source
 * @returns {Generator<{ line: number; value: string }>}
 */
function* stringLiterals(source) {
  let index = 0;
  let line = 1;
  while (index < source.length) {
    const char = source[index];
    if (char === '\n') {
      line += 1;
      index += 1;
    } else if (char === '/' && source[index + 1] === '/') {
      while (index < source.length && source[index] !== '\n') index += 1;
    } else if (char === '/' && source[index + 1] === '*') {
      index += 2;
      while (
        index < source.length &&
        !(source[index] === '*' && source[index + 1] === '/')
      ) {
        if (source[index] === '\n') line += 1;
        index += 1;
      }
      index += 2;
    } else if (char === "'" || char === '"' || char === '`') {
      const opened = line;
      let value = '';
      index += 1;
      while (index < source.length && source[index] !== char) {
        if (source[index] === '\\') {
          value += source[index + 1] ?? '';
          index += 2;
          continue;
        }
        if (source[index] === '\n') line += 1;
        value += source[index];
        index += 1;
      }
      index += 1;
      yield { line: opened, value };
    } else {
      index += 1;
    }
  }
}

/**
 * The literals in one story source that address a fixture without the
 * resolver, each with the line it sits on.
 *
 * A query or a fragment names the same file, so both are cut before the set is
 * asked. A `//` opening is left alone: that is a protocol-relative URL, which
 * addresses another origin and never resolves into `public/` at all.
 * @param {string} source the contents of a story or story component
 * @param {ReadonlySet<string>} fixtures paths relative to apps/storybook/public
 * @returns {{ line: number; path: string }[]}
 */
export const storyFixtureProblems = (source, fixtures) => {
  /** @type {{ line: number; path: string }[]} */
  const problems = [];
  for (const { line, value } of stringLiterals(source)) {
    if (!value.startsWith('/') || value.startsWith('//')) continue;
    const path = value.split(/[?#]/)[0];
    if (fixtures.has(path.slice(1))) problems.push({ line, path });
  }
  return problems;
};

/**
 * Every file under a directory, as paths relative to it with `/` separators --
 * the form a URL names them in.
 * @param {string} dir
 * @returns {Set<string>}
 */
export const fixturePaths = (dir) =>
  new Set(
    readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) =>
        relative(dir, join(entry.parentPath, entry.name)).split(sep).join('/')
      )
  );

/**
 * The story sources to read: the TypeScript under `stories/`, which is every
 * file that renders a story or the components one mounts.
 *
 * The `.mdx` beside them is not read. It is markdown, where an apostrophe in
 * prose opens nothing and the scan above would mistake several for strings,
 * and the fixtures live in the stories those pages embed rather than in the
 * pages. `stories/reference/reference-player.tsx` *is* read, like any other
 * source: it declares a second copy of the resolver, because the lint rule
 * scoping that directory denies the import, and a root-absolute literal is the
 * same defect there.
 * @param {string} dir
 * @returns {string[]}
 */
const storySources = (dir) =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name));

const main = () => {
  const fixtures = fixturePaths(join(repoRoot, PUBLIC));
  if (fixtures.size === 0) {
    throw new Error(
      `${PUBLIC} holds no files, so this check would pass whatever the stories address. Point it at the fixtures again, or delete it with them.`
    );
  }

  const found = storySources(join(repoRoot, STORIES)).flatMap((path) =>
    storyFixtureProblems(readFileSync(path, 'utf8'), fixtures).map(
      (problem) =>
        `${relative(repoRoot, path)}:${problem.line} addresses the fixture ${problem.path} with a root-absolute literal`
    )
  );

  if (found.length > 0) {
    throw new Error(
      `A story addresses a fixture without ${STORIES}/asset-url.ts:\n${found.join('\n')}\n\nThe workbench is served from whatever \`PLAYDECK_BASE_PATH\` says, so a root-absolute literal resolves outside it and 404s under any prefix (#435). Write \`assetUrl('tracer.mp4')\` instead of \`"/tracer.mp4"\`.`
    );
  }
  console.log(
    `Every fixture the stories address goes through ${STORIES}/asset-url.ts.`
  );
};

// Only when run as a command: story-fixtures.test.mjs imports this module for
// the judgement, and importing it must not read the repository.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(
      `\n${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
  }
}
