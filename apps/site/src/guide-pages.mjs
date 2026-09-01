/*
 * Which library-wide documents get a guide page, and what has to come off a
 * Storybook MDX file before Markdown can render it.
 *
 * The source files are the workbench's own `Overview/*` documents, in
 * `apps/storybook/stories/`, whole and unedited. They were the only place the
 * data-attribute contract, the caption model, the provider capability
 * differences and the optional stylesheet were written down, and they were
 * reachable only through a published Storybook — which is the same failure
 * #435 was filed about for the package READMEs and #523 closed by rendering
 * them. So these pages render those files rather than retelling them: editing
 * one edits the page, and there is no second copy for an edit to forget.
 *
 * That matters twice over here, because most of them are in
 * `scripts/docs-examples.mjs`'s checked list — their `ts`, `tsx` and `css`
 * fences are generated from real files in `examples/` and `pnpm docs:check`
 * compares them byte for byte. A site-native retelling would have put the
 * rendered example and the gated one in two places, which is exactly the
 * arrangement that gate exists to make impossible.
 *
 * ---- why this is Markdown and not MDX --------------------------------------
 *
 * None of these files contains live JSX. Every capitalised tag in them —
 * `<Player.Time>`, `<PlayIcon />` — is inside backticks or inside a fence,
 * where it is text. The real MDX constructs are few, and every one of them is
 * Storybook's rather than the document's: the `import` of `Meta`, the `<Meta>`
 * tag that files the page under a sidebar title, and the `{/* … *\/}` comments
 * `scripts/docs-examples.mjs` marks its generated fences with. Take those away
 * and what is left is Markdown, so this site needs no MDX integration and no
 * new dependency to publish them — `stripStorybook` below is the whole of it.
 *
 * They are removed rather than tolerated because each would otherwise be
 * rendered as prose: an `import` line becomes a paragraph, and so does a
 * marker comment. The `import` and the tag throw when they are missing, and that is
 * deliberate — a Storybook MDX file always has both, so their absence means the
 * file's shape changed under this module, and a build that failed is better
 * than a page that opens with the word `import`.
 *
 * This is `.mjs` rather than `.ts` for the reason `src/reference-packages.mjs`
 * and `src/provider-pages.mjs` are: it reaches `astro:content`, whose
 * declarations are generated into the `.astro/` directory the site's
 * `tsconfig.json` deliberately does not read. Nothing type-checks it — there is
 * no `astro check` in this repository — so what stands behind it is `astro
 * build`, which runs this module for real on every build.
 */

import { getCollection } from 'astro:content';

/**
 * The documents that get a page, in the order a reader meets them.
 *
 * Contract first because it is the one every other page assumes: a headless
 * library's parts are its whole styling surface. Then what each provider can
 * actually do, then captions, then the optional stylesheet — which is the last
 * in the list because it is the only one a consumer can decline entirely.
 *
 * The `Overview/*` documents that are **not** here are absent by decision
 * rather than by oversight, and the decision is the same for both: their
 * subject is the workbench and not the library. `Introduction.mdx` documents
 * how to write a story — the mock decorator, `stories/support.tsx`, the axe
 * setting in `.storybook/preview.tsx`; `reference/Reference.mdx` documents a
 * story mounting, the ESLint rule scoped to `stories/reference/**`, and which
 * spec file runs which check. Both are read by somebody working in this
 * repository with the workbench running, which is where they stay. `README.md`
 * linked to each of them and no longer does.
 *
 * `slug` is written here rather than derived from the document's title, which
 * is the opposite of what `src/provider-pages.mjs` does and for a reason that
 * does not apply there: these addresses are printed inside
 * `packages/react/README.md`, which ships in an npm tarball, so a link to one
 * of them is only fixable by a release. A slug derived from an `# ` heading
 * would move the address the day somebody rewords the heading, and nothing
 * would fail.
 *
 * @type {readonly { file: string; slug: string }[]}
 */
export const GUIDES = [
  { file: 'apps/storybook/stories/Contract.mdx', slug: 'contract' },
  {
    file: 'apps/storybook/stories/CapabilitiesMatrix.mdx',
    slug: 'capabilities-matrix'
  },
  { file: 'apps/storybook/stories/Captions.mdx', slug: 'captions' },
  { file: 'apps/storybook/stories/Theme.mdx', slug: 'theme' }
];

/** Storybook's `import` of the docs blocks, which is always the first line. */
const META_IMPORT =
  /^import \{ Meta \} from '@storybook\/addon-docs\/blocks';$/;

/** The tag that files the document under a sidebar title. */
const META_TAG = /^<Meta title="(.+)" \/>$/;

/**
 * An MDX comment on a line of its own, which in these files is always one of
 * `scripts/docs-examples.mjs`'s markers — the one that opens a generated
 * region, the one that closes it, or the `example:ignore` that excuses a fence
 * no fixture generates. They are comments to MDX and paragraphs to Markdown,
 * so they come out.
 *
 * Only a whole line, and never inside a fence. A fence here is generated from a
 * file in `examples/` and compared against it byte for byte, so anything that
 * edited one would put this site and that gate into disagreement about what the
 * example is.
 */
const MDX_COMMENT = /^\{\/\*.*\*\/\}$/;

/**
 * A GitHub URL naming a package in this repository, which this site publishes
 * itself. `blob` and `tree` both, because a README is linked either way and
 * `Theme.mdx` uses `tree`.
 */
const PACKAGE_ON_GITHUB =
  /^https:\/\/github\.com\/[^/]+\/[^/]+\/(?:blob|tree)\/[^/]+\/packages\/([^/#]+)(?:\/README\.md)?(#.+)?$/;

/**
 * One link target, as this site needs it rather than as the workbench does.
 *
 * One class of target is rewritten and everything else is left exactly as
 * written. A link to a package's README on GitHub — which is how these
 * documents have to write it, since a Storybook page has no other address for
 * one — sends a reader out of the site to read a document the site renders two
 * clicks away, so it becomes that package's own reference page with its
 * fragment kept. Only for a package that has a page: the set comes from
 * `referencePackageDirs`, and a link to one that has none is left alone rather
 * than pointed at a route that would 404.
 *
 * Through `import.meta.env.BASE_URL`, which is what Astro fills the configured
 * `base` into, and never as a literal `/reference/`. The prefix is the root
 * today and the literal would be identical, which is exactly why the habit is
 * kept: a hand-written path is the bug a base path exists to prevent (#435).
 *
 * There is no rewriting of relative targets here, unlike the two collections
 * beside this one. A target relative to a Storybook MDX file resolves against
 * the workbench's own routing rather than against a directory, so there is no
 * path this could rewrite it to.
 *
 * `Contract.mdx` did carry one — `?path=/docs/reference-player--docs`, which
 * the workbench resolves and this site shipped verbatim, reloading the guide
 * with a query string on it. It was fixed in the document rather than special
 * cased here, because the same sentence is read on both surfaces and only one
 * of them ever made sense of the link. A relative or `?path=` target added to
 * one of these documents later ships as written and goes nowhere here; write
 * the reference as prose, or as a full GitHub URL where a URL is wanted.
 *
 * @param {string} target
 * @param {ReadonlySet<string>} pages
 * @returns {string}
 */
const rewriteTarget = (target, pages) => {
  const pkg = PACKAGE_ON_GITHUB.exec(target);
  return pkg !== null && pages.has(pkg[1])
    ? `${import.meta.env.BASE_URL}reference/${pkg[1]}/${pkg[2] ?? ''}`
    : target;
};

/**
 * The document with Storybook's three constructs removed and those targets
 * redirected, and nothing else touched.
 *
 * One pass, because both jobs need the same thing: to know whether the line
 * they are looking at is inside a fenced block. Fenced lines are handed
 * straight through — see `MDX_COMMENT` above for why that is a requirement and
 * not a tidiness.
 *
 * What the link rewriting handles is what `src/content.config.ts` and
 * `src/provider-pages.mjs` handle for their own documents, and one regular
 * expression is worth more than a parser on a corpus two gates already read: an
 * inline `[text](target)` whose target has no spaces and no parentheses, on a
 * line outside a fence. An image, a title, an angle-bracketed target and a
 * reference-style definition are left as written, which for a link to a package
 * README means a trip to GitHub rather than a broken address.
 *
 * @param {string} source
 * @param {string} file the path in the repository, for the errors below
 * @param {ReadonlySet<string>} pages
 * @returns {{ title: string; markdown: string }}
 */
export const guideDocument = (source, file, pages) => {
  const lines = source.split('\n');
  if (!lines.some((line) => META_IMPORT.test(line))) {
    throw new Error(
      `${file} does not import Storybook's \`Meta\` block, so src/guide-pages.mjs cannot tell what to strip before rendering it as Markdown. If that file stopped being a Storybook document, load it as Markdown instead of stripping it.`
    );
  }
  if (!lines.some((line) => META_TAG.test(line))) {
    throw new Error(
      `${file} carries no \`<Meta title="…" />\` tag. It is the line that would otherwise render as a paragraph at the top of that guide page — check what replaced it and update src/guide-pages.mjs.`
    );
  }

  /** @type {string[]} */
  const kept = [];
  let fenced = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      kept.push(line);
      continue;
    }
    if (fenced) {
      kept.push(line);
      continue;
    }
    if (
      META_IMPORT.test(line) ||
      META_TAG.test(line) ||
      MDX_COMMENT.test(line)
    ) {
      continue;
    }
    kept.push(
      line.replace(
        /(?<!!)\]\(([^()\s]+)\)/g,
        (_, target) => `](${rewriteTarget(target, pages)})`
      )
    );
  }

  const markdown = kept.join('\n').trim();
  const title = /^# (.+)$/m.exec(markdown)?.[1];
  if (title === undefined) {
    throw new Error(
      `${file} has no level-one heading. That heading is the guide page's own title, its breadcrumb and its entry in the rail, so there is nothing to call the page without it.`
    );
  }
  return { title, markdown };
};

/**
 * The guides, in the order `GUIDES` lists them, each with the rendered entry
 * the route puts on screen.
 *
 * `order` is stored on the entry rather than recovered here, for the reason
 * `src/provider-pages.mjs` gives: a content collection hands entries back in
 * whatever order its store iterates, and alphabetical would be a different
 * order for no reason.
 *
 * @typedef {{ slug: string; title: string; entry: import('astro:content').CollectionEntry<'guides'> }} GuidePage
 * @returns {Promise<GuidePage[]>}
 */
export const guidePages = async () => {
  const entries = await getCollection('guides');
  return entries
    .sort((a, b) => a.data.order - b.data.order)
    .map((entry) => ({
      slug: entry.id,
      title: entry.data.title,
      entry
    }));
};
