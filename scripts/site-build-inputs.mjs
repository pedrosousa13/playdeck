// What `turbo.json`'s `@playdeck/site#build` task's `inputs` declares, and
// whether every plain relative import `apps/site/src` makes across the
// package's own boundary is one of them.
//
// This catches one mechanism and not the other. `src/pages/examples.astro`
// importing `'../../../../examples/archetype-streaming-service'` is a string
// this module can find by reading the file and matching an `import` syntax --
// so is `src/comparison-page.mjs`'s `import { publishablePackages } from
// '../../../scripts/workspace-packages.mjs'`, which is exactly the shape #711
// found missing. A path assembled at runtime -- `readFileSync(join(repoRoot,
// COMPARISON_DIR, file))` in that same module, or `join(pkg.path,
// 'package.json')` in `src/reference-packages.mjs` -- is not: `repoRoot`,
// `COMPARISON_DIR` and `pkg.path` are values, not source text naming a path,
// and finding what they resolve to in general means running the module rather
// than reading it. `docs/provider-setup.md`, `docs/comparison/**`,
// `apps/storybook/stories/*.mdx`, `packages/*/README.md` and
// `packages/*/package.json` all reach the site build this second way, so this
// module cannot verify any of the five -- they were added to `turbo.json` by
// the audit #711 recorded, and this module's static-import check stands
// beside that audit rather than replacing it.
//
// Two narrower gaps sit inside the mechanism this module does cover. It
// walks only `apps/site/astro.config.ts` and `apps/site/src`, and never
// follows into a script one of those files imports -- so a new
// `scripts/*.mjs` import added inside `scripts/readme-bytes.mjs` itself
// would cross this package's boundary unseen. And `FROM_SPECIFIER` and
// `BARE_SPECIFIER` both match a static `import`/`from` clause; neither
// matches `await import('…')` or `import.meta.glob('…')`, so either form
// would also escape undetected.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

/** An `import`/`export … from` specifier, or a side-effect `import '…'`. */
const FROM_SPECIFIER = /\bfrom\s+['"]([^'"]+)['"]/g;
const BARE_SPECIFIER = /\bimport\s+['"]([^'"]+)['"]/g;

/**
 * Every relative import specifier (`./…` or `../…`) a file's text names,
 * bare module specifiers (`astro:content`, `@playdeck/react`, `react`, …)
 * excluded -- those never leave the package by way of a path.
 *
 * @param {string} text
 * @returns {string[]}
 */
export const relativeImportSpecifiers = (text) => {
  const found = [];
  for (const pattern of [FROM_SPECIFIER, BARE_SPECIFIER]) {
    for (const match of text.matchAll(pattern)) {
      if (match[1].startsWith('.')) found.push(match[1]);
    }
  }
  return found;
};

/** Extensions this walk reads for import specifiers. Astro's own template
 * markup carries no `import`/`from` syntax outside its frontmatter and any
 * `<script>` blocks, both of which are ordinary text this still matches. */
const SCANNED_EXTENSIONS = new Set(['.ts', '.tsx', '.mjs', '.astro']);

/**
 * Every file under `dir` with a scanned extension, repository-relative.
 *
 * @param {string} dir absolute
 * @returns {string[]}
 */
const walk = (dir) => {
  /** @type {string[]} */
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...walk(full));
    } else if (SCANNED_EXTENSIONS.has(extname(entry))) {
      files.push(full);
    }
  }
  return files;
};

/**
 * One file's relative imports, resolved against its own directory and
 * reduced to the ones that land outside `apps/site/` -- a POSIX path
 * relative to the repository root, regardless of the platform this runs on.
 *
 * @param {string} fileAbsolute
 * @returns {string[]}
 */
const escapingImportsOf = (fileAbsolute) => {
  const text = readFileSync(fileAbsolute, 'utf8');
  return relativeImportSpecifiers(text)
    .map((specifier) =>
      relative(repoRoot, resolve(dirname(fileAbsolute), specifier))
        .split(sep)
        .join('/')
    )
    .filter((path) => !path.startsWith('apps/site/'));
};

/**
 * Every path outside `apps/site/` that a plain relative import in
 * `apps/site/src` or `apps/site/astro.config.ts` names, repository-relative
 * and de-duplicated.
 *
 * @param {string} [root] The repository root.
 * @returns {string[]}
 */
export const escapingImports = (root = repoRoot) => {
  const files = [
    join(root, 'apps/site/astro.config.ts'),
    ...walk(join(root, 'apps/site/src'))
  ];
  const found = new Set();
  for (const file of files) {
    for (const path of escapingImportsOf(file)) found.add(path);
  }
  return [...found].sort();
};

/**
 * `turbo.json`'s `//`-commented JSON, parsed. This repository's own comment
 * style keeps every one on a line of its own -- never trailing after a value
 * on the same line -- so dropping a line that starts with `//` (whitespace
 * aside) is the whole of what stripping them needs.
 *
 * @param {string} text
 * @returns {unknown}
 */
export const parseTurboJson = (text) =>
  JSON.parse(
    text
      .split('\n')
      .filter((line) => !/^\s*\/\//.test(line))
      .join('\n')
  );

/**
 * `@playdeck/site#build`'s declared `inputs`, `$TURBO_DEFAULT$` dropped and
 * each glob rewritten from package-relative (`../../examples/**`) to
 * repository-relative (`examples/**`) -- the same frame `escapingImports`
 * resolves its own paths into.
 *
 * @param {unknown} turboJson
 * @returns {string[]}
 */
export const siteBuildInputGlobs = (turboJson) => {
  const inputs = /** @type {any} */ (turboJson)?.tasks?.['@playdeck/site#build']
    ?.inputs;
  if (!Array.isArray(inputs)) {
    throw new Error(
      "turbo.json has no tasks['@playdeck/site#build'].inputs array to read."
    );
  }
  return inputs
    .filter((glob) => glob !== '$TURBO_DEFAULT$')
    .map((glob) => {
      if (!glob.startsWith('../../')) {
        throw new Error(
          `${glob} is not rooted at "../../", so this cannot rewrite it into a repository-relative glob. Package-relative inputs deeper or shallower than apps/site's own nesting need a second case here.`
        );
      }
      return glob.slice('../../'.length);
    });
};

/**
 * One glob (only `*` and `**` -- the two this repository's `turbo.json` uses)
 * turned into a `RegExp` anchored at both ends.
 *
 * @param {string} glob
 * @returns {RegExp}
 */
const globToRegExp = (glob) => {
  /** @param {string} segment */
  const escapeLiteral = (segment) =>
    segment.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const pattern = glob
    .split('**')
    .map((piece) => piece.split('*').map(escapeLiteral).join('[^/]*'))
    .join('.*');
  return new RegExp(`^${pattern}$`);
};

/**
 * Every path in `paths` that no glob in `globs` matches.
 *
 * @param {readonly string[]} paths
 * @param {readonly string[]} globs
 * @returns {string[]}
 */
export const uncovered = (paths, globs) => {
  const patterns = globs.map(globToRegExp);
  return paths.filter(
    (path) => !patterns.some((pattern) => pattern.test(path))
  );
};
