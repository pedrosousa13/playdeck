/*
 * The library comparison guide: one page composed from the three documents
 * `pnpm compare:libraries` and `pnpm compare:features` generate and
 * `docs/comparison/method.md` explains, published at `/guides/comparison/`
 * (issue #637, amending the #543/#638 ruling that nothing be published for
 * one route).
 *
 * It is a fourth entry in the `guides` collection in `src/content.config.ts`
 * rather than a fourth `defineCollection`, and a fourth module beside
 * `reference-packages.mjs`, `provider-pages.mjs` and `guide-pages.mjs` rather
 * than a case added to `guide-pages.mjs` itself. Both choices follow the same
 * reasoning stated at each of those seams already: the route this page needs
 * -- one more `/guides/<slug>/` -- is exactly what the existing collection and
 * `src/pages/guides/[guide].astro` already serve, so a second collection would
 * duplicate that route generation for no reason; but composing three files
 * into one document with their own headings demoted is a different job from
 * stripping Storybook's scaffolding off one MDX file, with a link-rewriting
 * rule of its own, so it gets a module of its own rather than a branch in
 * `guideDocument`.
 *
 * ---- one h1, composed mechanically -----------------------------------------
 *
 * The page's own title, `TITLE` below, is not read out of any source file --
 * it is this guide's title the way "Guides" is the index page's. Each source
 * document keeps its own `# ` title, demoted by exactly one level so it
 * becomes this page's `##` section heading, and everything under it follows in
 * step: `demoteHeadings` shifts every ATX heading in a document down one level
 * and touches nothing else. Nothing is reworded, nothing is summarised, and
 * nothing is reordered -- `DOCUMENTS` below lists the three files in the order
 * the page renders them, which is also the order `results.md`, `features.md`
 * and `method.md` sit in this directory: the measured figures, the feature
 * matrix, then the method that explains both.
 *
 * ---- links -------------------------------------------------------------
 *
 * A relative link in one of these documents is right in two different ways,
 * and this rewrites it into whichever fits. A link naming one of the other two
 * documents this page renders becomes a fragment on this page, through an
 * explicit `<a id>` anchor placed just above each document's own section --
 * not a guess at the heading's own auto-generated slug, which this module has
 * no need to reproduce. A link naming a package that has a reference page
 * becomes that page, the same substitution `src/provider-pages.mjs` makes for
 * `docs/provider-setup.md`. Everything else relative resolves against
 * `docs/comparison/`'s own directory and becomes a GitHub blob url, the same
 * treatment `src/content.config.ts` gives a README's relative links. None of
 * the three source documents currently links to a repository path this way --
 * every mention of one is inline code, not a link -- so this rule has nothing
 * to rewrite today; it is here so a document that starts linking one stays
 * correct rather than silently shipping a 404 or a link off the page it is
 * already on.
 *
 * `pnpm test:site-links` is what checks the result, by walking the built
 * `apps/site/dist` rather than these sources -- see that script's own header.
 *
 * ---- the features table's icons ---------------------------------------
 *
 * Handled in `src/comparison-icons.mjs`, not here, and applied to this
 * module's rendered HTML rather than to the markdown this module returns: the
 * transform needs the compiled `<table>` a status word's footnote reference
 * has already become a real link inside, which only exists after
 * `renderMarkdown` has run. `src/content.config.ts`'s `guides` loader is what
 * calls both, in order.
 */

import { readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { publishablePackages } from '../../../scripts/workspace-packages.mjs';
import { referencePackageDirs } from './reference-packages.mjs';

/** Where the three source documents live, relative to the repository root. */
export const COMPARISON_DIR = 'docs/comparison';

/**
 * This guide's own title. Not read out of any source file -- see the header
 * comment above for why a page composed from three documents needs a title of
 * its own rather than borrowing one of theirs.
 */
const TITLE = 'React video library comparison';

/**
 * The three source documents, in the order the page renders them, each with
 * the id its section is anchored at for a same-page link to land on.
 *
 * @type {readonly { file: string; anchor: string }[]}
 */
const DOCUMENTS = [
  { file: 'results.md', anchor: 'results' },
  { file: 'features.md', anchor: 'features' },
  { file: 'method.md', anchor: 'method' }
];

/** Every source file this guide is built from, for the dev-server watcher. */
export const COMPARISON_FILES = DOCUMENTS.map(
  ({ file }) => `${COMPARISON_DIR}/${file}`
);

/*
 * The branch a link into the repository resolves against, and a fourth copy of
 * this constant: `src/content.config.ts` has one for the package READMEs,
 * `src/provider-pages.mjs` has one for `docs/provider-setup.md`, and
 * `scripts/verify-packaging.mjs` has the whole literal at its
 * `repositoryBlobUrl`. Not shared for the reason `src/provider-pages.mjs`
 * gives: each side needs a different shape built from a different source, so a
 * shared export would have to be decomposed on one side or recomposed on the
 * other to be used.
 */
const branch = 'main';

/**
 * Where this repository lives on GitHub, derived from the publishable
 * packages' own `repository` fields rather than written out -- the same
 * derivation `src/provider-pages.mjs` makes for `docs/provider-setup.md`, and
 * for the identical reason: a fourth literal of the same url is a fourth thing
 * to keep true, and every publishable package already has to agree on one.
 *
 * @param {string} repoRoot
 * @returns {string}
 */
const repositoryBlobUrl = (repoRoot) => {
  const slugs = new Set(
    publishablePackages(repoRoot).map((pkg) => {
      const manifest = JSON.parse(
        readFileSync(join(pkg.path, 'package.json'), 'utf8')
      );
      return /github\.com\/(.+?)(?:\.git)?$/.exec(
        manifest.repository?.url ?? ''
      )?.[1];
    })
  );
  const [slug] = [...slugs];
  if (slugs.size !== 1 || slug === undefined) {
    throw new Error(
      `The publishable packages do not agree on one GitHub repository (${[...slugs].join(', ')}), so ${COMPARISON_DIR}'s relative links have nothing to resolve against. Every publishable package's "repository" field names this repository.`
    );
  }
  return `https://github.com/${slug}/blob/${branch}/`;
};

/**
 * Every ATX heading in `markdown` shifted one level down (`#` becomes `##`,
 * and so on), outside fenced code blocks. This is the whole of "compose
 * mechanically" for these three documents: a source file's own heading
 * structure survives whole, one level lower, so its `# ` title becomes this
 * page's `##` section and everything beneath it follows in step. A heading
 * already at `######` is left alone; none of the three documents nests that
 * deep.
 *
 * @param {string} markdown
 * @returns {string}
 */
const demoteHeadings = (markdown) => {
  let fenced = false;
  return markdown
    .split('\n')
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        fenced = !fenced;
        return line;
      }
      if (fenced) {
        return line;
      }
      const heading = /^(#{1,6})(\s.*)?$/.exec(line);
      if (heading === null) {
        return line;
      }
      const [, hashes, rest = ''] = heading;
      return hashes.length >= 6 ? line : `#${hashes}${rest}`;
    })
    .join('\n');
};

/**
 * One link target, as this page needs it rather than as the repository does.
 * See the header comment's "Links" section for the three cases.
 *
 * @param {string} target
 * @param {{ blob: string; pages: ReadonlySet<string> }} context
 * @returns {string}
 */
const rewriteTarget = (target, { blob, pages }) => {
  if (
    target.startsWith('#') ||
    target.startsWith('/') ||
    /^[a-z][a-z0-9+.-]*:/i.test(target)
  ) {
    return target;
  }
  const [path, fragment = ''] = target.split('#');
  const resolved = posix.normalize(posix.join(COMPARISON_DIR, path));

  const sibling = DOCUMENTS.find(
    (document_) => resolved === posix.join(COMPARISON_DIR, document_.file)
  );
  if (sibling !== undefined) {
    return fragment === '' ? `#${sibling.anchor}` : `#${fragment}`;
  }

  const pkg = /^packages\/([^/]+)(?:\/README\.md)?$/.exec(resolved);
  if (pkg !== null && pages.has(pkg[1])) {
    return `${import.meta.env.BASE_URL}reference/${pkg[1]}/`;
  }

  return `${blob}${resolved}${fragment === '' ? '' : `#${fragment}`}`;
};

/**
 * The same document with its links redirected and nothing else touched. Steps
 * over fenced blocks for the reason every other loader in this app does: a
 * fence in these documents is not generated from `examples/`, but the habit of
 * never rewriting inside one is the same habit `pnpm docs:check` polices
 * elsewhere, and there is no upside to a second rule for a corpus that happens
 * not to need it yet.
 *
 * @param {string} markdown
 * @param {{ blob: string; pages: ReadonlySet<string> }} context
 * @returns {string}
 */
const rewriteLinks = (markdown, context) => {
  let fenced = false;
  return markdown
    .split('\n')
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        fenced = !fenced;
        return line;
      }
      return fenced
        ? line
        : line.replace(
            /(?<!!)\]\(([^()\s]+)\)/g,
            (_, target) => `](${rewriteTarget(target, context)})`
          );
    })
    .join('\n');
};

/**
 * The guide, composed from the three source documents on disk.
 *
 * @param {string} repoRoot
 * @returns {{ title: string; markdown: string }}
 */
export const comparisonDocument = (repoRoot) => {
  const context = {
    blob: repositoryBlobUrl(repoRoot),
    pages: new Set(referencePackageDirs(repoRoot))
  };

  const sections = DOCUMENTS.map(({ file, anchor }) => {
    const source = readFileSync(join(repoRoot, COMPARISON_DIR, file), 'utf8');
    const demoted = demoteHeadings(rewriteLinks(source, context));
    // The anchor sits above the section rather than on the heading itself, so
    // the heading stays a real ATX heading `renderMarkdown` extracts into the
    // headings metadata `DocRail`'s table of contents and this page's `h1`
    // count both read -- a raw `<h2 id="…">` written by hand here would render
    // the same text but stop being a heading node either of them can see.
    return `<a id="${anchor}"></a>\n\n${demoted}`;
  });

  return { title: TITLE, markdown: [`# ${TITLE}`, ...sections].join('\n\n') };
};
