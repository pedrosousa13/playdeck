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
// went with it. This is the cheaper one docs/adr/0007 asked for in its place:
// it reads the sources and starts neither a build nor a browser, so what it
// depends on is the repository and nothing that has to be served. It catches
// the authoring mistake directly rather than the 404 downstream, which also
// means it proves less — that a prefixed build works is still shown only by
// the two commands in apps/storybook/README.md.
//
// The judgement is a pure function and the IO is `main()` behind the CLI guard
// at the foot of the file, which is scripts/readme-bytes.mjs's shape: which
// literals are the defect is decided in `storyFixtureProblems` and exercised
// on hand-written sources by story-fixtures.test.mjs, and importing this
// module reads nothing.
//
// The strings are taken from TypeScript's own parser rather than from a scan
// of the characters. A scan cannot tell a string from JSX text, and an
// apostrophe in JSX prose -- `<p>it's fine</p>` -- reads to one as a string
// that opens and never closes, which desyncs everything after it: a real
// bypass further down the same file then goes unreported and the gate silently
// stops gating. A quote inside a regular expression does the same thing, and
// `stories/parts.contract.test.ts` holds one. The parser has no such state to
// lose: JSX text arrives as `JsxText` and a regular expression as a regular
// expression, neither being a string, comments are not nodes at all, and the
// files that document this rule can go on naming the literal not to write.
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
import ts from 'typescript';

const console = globalThis.console;
const process = globalThis.process;
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

const STORIES = 'apps/storybook/stories';
const PUBLIC = 'apps/storybook/public';

/**
 * Every string a source spells out, with the line it starts on: the string
 * literals, and each literal chunk of a template. A template's chunks are
 * taken one by one rather than as a whole, so a rule inside a long CSS
 * template is reported on its own line, and so that nothing inside `${...}` --
 * an expression, not text -- is read as a path.
 * @param {string} source
 * @returns {{ line: number; value: string }[]}
 */
const spelledStrings = (source) => {
  const file = ts.createSourceFile(
    'story.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );

  /** @type {{ line: number; value: string }[]} */
  const strings = [];
  /** @param {ts.Node} node */
  const visit = (node) => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      strings.push({
        line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
        value: node.text
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return strings;
};

/**
 * The paths one string spells out, each with where in the string it starts, in
 * the three shapes a fixture is addressed in. The whole string is the plain case (`src="/tracer.mp4"`); a `url(...)`
 * payload, quoted or bare, is how CSS names one, and the issue that asked for
 * this check named it; and a descriptor list (`srcSet`, `sizes`) is
 * comma-separated candidates each ending at their first space --
 * `player-fixture.stories.tsx` already writes one of those through the
 * resolver, so the bypass form of that line has to be visible from here.
 * @param {string} value
 * @returns {{ path: string; offset: number }[]}
 */
const spelledPaths = (value) => {
  /** @type {{ path: string; offset: number }[]} */
  const paths = [{ path: value, offset: 0 }];

  for (const match of value.matchAll(/url\(\s*(['"]?)([^'")\s]*)\1\s*\)/g)) {
    paths.push({
      path: match[2],
      offset: (match.index ?? 0) + match[0].indexOf(match[2])
    });
  }

  let at = 0;
  for (const part of value.split(',')) {
    const leading = part.length - part.trimStart().length;
    paths.push({
      path: part.trim().split(/\s/)[0],
      offset: at + leading
    });
    at += part.length + 1;
  }
  return paths;
};

/**
 * The literals in one story source that address a fixture without the
 * resolver, each with the line it sits on. A template chunk can be many lines
 * long, so the line is counted to where the path starts rather than taken from
 * where the chunk does. One fixture named twice on one line is one finding.
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
  /** @type {Set<string>} */
  const seen = new Set();
  for (const { line, value } of spelledStrings(source)) {
    for (const { path: candidate, offset } of spelledPaths(value)) {
      if (!candidate.startsWith('/') || candidate.startsWith('//')) continue;
      const path = candidate.split(/[?#]/)[0];
      if (!fixtures.has(path.slice(1))) continue;
      const at = line + value.slice(0, offset).split('\n').length - 1;
      if (seen.has(`${at}\t${path}`)) continue;
      seen.add(`${at}\t${path}`);
      problems.push({ line: at, path });
    }
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
 * The story sources to read: every `.ts` and `.tsx` under `stories/` — the
 * stories, the components they mount, and the contract tests and helpers
 * beside them. Reading more than renders is deliberate: the defect is the
 * literal rather than what renders it, and a rule that had to decide which
 * files render would be a list to keep true.
 *
 * The `.mdx` beside them is not read, and that is a hole rather than a
 * judgement — it is markdown, the parser above is TypeScript's, and nothing
 * here parses MDX. `apps/storybook/README.md` says so where it describes what
 * this covers. `stories/reference/reference-player.tsx` *is* read, like any
 * other source: it declares a second copy of the resolver, because the lint
 * rule scoping that directory denies the import, and a root-absolute literal
 * is the same defect there.
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
