/*
 * Which providers get a setup page, and how one document becomes four of them.
 *
 * The source is `docs/provider-setup.md`, whole and unedited. That file is in
 * `scripts/docs-examples.mjs`'s checked list, so the two fences inside it are
 * generated from real files in `examples/` and `pnpm docs:check` compares them
 * byte for byte; its prose was written against a detector that was run rather
 * than read. A site-native retelling of any of that would be a second copy no
 * gate watches, which is the drift `src/content.config.ts` was written to
 * remove for the package READMEs (#523) and the reason this ticket renders
 * rather than rewrites (#524).
 *
 * A page here is therefore a *selection* of that document and never a summary
 * of it: the intro, the provider's own material, and every section that applies
 * to all of them, in the order the document puts them in. Nothing is
 * paraphrased, no sentence is written here, and editing a paragraph in
 * `docs/provider-setup.md` edits the page it appears on.
 *
 * Two structural things are done to the text on the way through, and both are
 * transforms rather than edits:
 *
 * - The section heading a provider's material sits under is dropped, because
 *   the page's `h1` is that provider's name and `## YouTube` directly beneath a
 *   heading reading "YouTube" is the same word twice. For the three providers
 *   the document covers under one heading, the bold lead that opens each one
 *   (`**Wistia.** Hosts are ...`) is what names them and is dropped for the
 *   same reason.
 * - That material is moved to the top, ahead of the shared sections. In the
 *   document the shared rules come first because a reader is going through it
 *   once, front to back; a reader on `/providers/vimeo/` came for Vimeo. The
 *   cross-references survive the move because they were never forward
 *   references out of a provider's section: `see below` in the grouped section
 *   points at *Explicit source objects*, which still follows it, and *Shared
 *   rules* refers to `a path shape not listed above`, which is now genuinely
 *   above it rather than several sections down.
 *
 * One sentence does not survive, and it is named here rather than left to be
 * discovered: `Covered here as well, because the detector treats all five the
 * same way.` opens `## The other three providers` and is a connective about
 * that grouping. Split into a page each, there is no grouping for it to be
 * about. It is the only sentence of the document that reaches no page.
 *
 * This is `.mjs` rather than `.ts` for the reason `src/reference-packages.mjs`
 * is: it reaches `astro:content`, whose declarations are generated into the
 * `.astro/` directory the site's `tsconfig.json` deliberately does not read,
 * and a module belonging to the `scripts` project. Astro's own tooling checks
 * it, in the same pass that checks the `.astro` templates.
 */

import { getCollection } from 'astro:content';
import { readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { publishablePackages } from '../../../scripts/workspace-packages.mjs';
import { referencePackageDirs } from './reference-packages.mjs';

/**
 * Where the document is, relative to the repository root. Named once because
 * three things need it: the loader reads it, the link rewriting resolves the
 * document's relative targets against the directory it sits in, and the dev
 * watcher matches changes against it.
 */
export const PROVIDER_SETUP_DOC = 'docs/provider-setup.md';

/**
 * The providers, and where each one's material is in the document.
 *
 * Two of them have a `## ` section of their own; the other three share
 * `## The other three providers`, where each is opened by a bold lead. `lead`
 * is what tells those apart, and a page whose `lead` is absent takes its whole
 * section.
 *
 * The set is stated rather than derived, unlike `src/reference-packages.mjs`'s,
 * and the difference is that there is nothing to derive it from. Publishable is
 * a property of a manifest and `pnpm list -r` answers it; "is this section
 * about one provider" is a property of prose. What keeps the two in step is the
 * throw in `providerDocuments` below: a heading in that document classified by
 * neither this table nor `SHARED_SECTIONS` fails the build, so a sixth provider
 * documented there cannot quietly go unpublished, and cannot quietly appear on
 * every other provider's page either.
 *
 * `packages` is the adapter each page is about, for the link to its reference
 * page. It is stated because the document names a package for YouTube and Vimeo
 * and for nobody else, so there is no link in the source to read the other
 * three off — and the reference page is where "what this adapter reports" is
 * written down.
 *
 * @type {readonly { heading: string; lead?: string; packages: readonly string[] }[]}
 */
const PROVIDERS = [
  { heading: 'YouTube', packages: ['provider-youtube'] },
  { heading: 'Vimeo', packages: ['provider-vimeo'] },
  {
    heading: 'The other three providers',
    lead: 'Wistia',
    packages: ['provider-wistia']
  },
  {
    heading: 'The other three providers',
    lead: 'Native files and HLS',
    // Two adapters and one page, because the document covers them in one
    // passage and is right to: neither has a host list, the extension of the
    // path is what chooses between them, and the table that does the choosing
    // is a single table. Splitting it would mean writing two of them.
    packages: ['provider-native', 'provider-hls']
  }
];

/**
 * The sections that are about every provider, and so appear on every page.
 *
 * Written out rather than defined as "whatever is left", so that a section
 * added to the document has to be classified by somebody rather than defaulting
 * onto four pages. See the throw in `providerDocuments`.
 */
const SHARED_SECTIONS = [
  'The `source` prop',
  'Shared rules for a source string',
  'Explicit source objects',
  'What a refusal reads like'
];

/*
 * The branch a link out of this document resolves against, and the third copy
 * of this constant in the repository: `src/content.config.ts` has one for the
 * package READMEs and `scripts/verify-packaging.mjs` has the whole literal at
 * its `repositoryBlobUrl`. All three have to agree, and nothing fails if they
 * stop agreeing -- that gate only checks links that already start with its own
 * url, so a branch changed here alone would send readers to a ref that gate has
 * never looked at. They are not one exported value because they are not one
 * shape: that side needs a prefix to match against, `content.config.ts` needs a
 * url per package built from that package's `repository` field, and this side
 * needs one url for the repository itself.
 */
const branch = 'main';

/**
 * Where a file in this repository lives on GitHub.
 *
 * Derived from the publishable manifests rather than written out, because a
 * fourth literal of the same url is a fourth thing to keep true and this one
 * has a source: every published package points `repository.url` at this
 * repository, npm shows that url, and `scripts/verify-packaging.mjs` fails a
 * package whose manifest fields do not survive packing. The root manifest
 * carries no `repository` field to read instead. Requiring the packages to
 * agree is what makes the derivation honest rather than a guess taken off
 * whichever package happened to sort first.
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
      `The publishable packages do not agree on one GitHub repository (${[...slugs].join(', ')}), so ${PROVIDER_SETUP_DOC}'s relative links have nothing to resolve against. Every publishable package's "repository" field names this repository.`
    );
  }
  return `https://github.com/${slug}/blob/${branch}/`;
};

/**
 * The document, split at its `## ` headings.
 *
 * The first entry has no heading and is everything above the first one: the
 * title and the introduction. Fenced blocks are stepped over, because the two
 * examples in this document are generated from `examples/` by
 * `scripts/docs-examples.mjs` and a `##` in a comment inside one is a comment
 * and not a section.
 *
 * @param {string} source
 * @returns {{ heading?: string; text: string }[]}
 */
const sections = (source) => {
  /** @type {{ heading?: string; lines: string[] }[]} */
  const found = [{ lines: [] }];
  let fenced = false;
  for (const line of source.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
    }
    const heading = fenced ? null : /^## (.+)$/.exec(line);
    if (heading === null) {
      found[found.length - 1].lines.push(line);
    } else {
      found.push({ heading: heading[1], lines: [line] });
    }
  }
  return found.map(({ heading, lines }) => ({
    heading,
    text: lines.join('\n').trim()
  }));
};

/**
 * A provider's own material, cut out of the section it sits in.
 *
 * With no `lead` that is the section without its heading line. With one it is
 * the run of blocks from that provider's bold lead up to the next provider's,
 * and the lead itself is removed from the front of the first paragraph — the
 * page's `h1` says the name, and `**Wistia.** Hosts are ...` under a heading
 * reading "Wistia" says it twice.
 *
 * A lead that is nowhere in the section throws rather than returning nothing,
 * because it means the document moved under a table that still describes where
 * that provider used to be, and a page rendered with its material silently
 * missing is the failure this whole arrangement exists to make impossible. The
 * matching failure for a section that is not there at all is `providerDocuments`
 * below, which is where the section is looked up.
 *
 * @param {{ heading?: string; text: string }} section
 * @param {{ heading: string; lead?: string }} provider
 * @returns {string}
 */
const providerSlice = (section, provider) => {
  const body = section.text.replace(/^## .+\n*/, '');
  if (provider.lead === undefined) {
    return body;
  }
  // A bold lead opens a paragraph and names its provider with a full stop
  // inside the emphasis: `**Native files and HLS.** These have no host list`.
  // That shape is what separates the three, and it is also what stops this
  // matching the `**Not readable**` labels in *What a refusal reads like*,
  // which carry no full stop inside the emphasis -- though those are in a
  // shared section this function is never handed.
  const blocks = body.split('\n\n');
  const opens = (block) => /^\*\*(.+?)\.\*\*\s/.exec(block)?.[1];
  const start = blocks.findIndex((block) => opens(block) === provider.lead);
  if (start === -1) {
    throw new Error(
      `${PROVIDER_SETUP_DOC} has no paragraph opening "**${provider.lead}.**" under "## ${provider.heading}", so that provider's setup page has nothing to render. Either the lead was renamed, or the provider moved to a section of its own — update PROVIDERS in src/provider-pages.mjs to match.`
    );
  }
  const after = blocks.findIndex(
    (block, index) => index > start && opens(block) !== undefined
  );
  const slice = blocks.slice(start, after === -1 ? undefined : after);
  slice[0] = slice[0].replace(/^\*\*.+?\.\*\*\s+/, '');
  return slice.join('\n\n').trim();
};

/**
 * One link target, as this site needs it rather than as the repository does.
 *
 * The document is read in two places and its relative links are right in only
 * one of them. Written to be read from `docs/`, `third-party-requests.md` sits
 * beside it and `adr/0004-...` sits under it; from `/providers/vimeo/` both
 * resolve to nothing at all. So a relative target is resolved against the
 * document's own directory and pointed at the file's real home on GitHub, which
 * is where a reader of the site was always going to have to end up — except for
 * the one class of target this site publishes itself. `../packages/provider-vimeo`
 * is a package with a reference page, so it becomes that page rather than a trip
 * to GitHub to read a README the site is already rendering.
 *
 * Through `import.meta.env.BASE_URL`, which is what Astro fills the configured
 * `base` into, and never as a literal `/reference/`. The prefix is the root
 * today and the literal would be identical, which is exactly why the habit is
 * kept: a hand-written path is the bug a base path exists to prevent (#435).
 *
 * A fragment-only target is left alone, and that is load-bearing rather than
 * lazy: the document's `#what-a-refusal-reads-like` and
 * `#explicit-source-objects` name shared sections, every page carries every
 * shared section, so the fragment resolves on whichever page the link was read
 * on. A fragment naming a provider's own section would not, and there is none —
 * the two headings that were dropped are not linked to from anywhere in the
 * document.
 *
 * Everything else — an absolute url, a root-relative path — is left as written.
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
  const resolved = posix.normalize(
    posix.join(posix.dirname(PROVIDER_SETUP_DOC), path)
  );
  const pkg = /^packages\/([^/]+)(?:\/README\.md)?$/.exec(resolved);
  return pkg !== null && pages.has(pkg[1])
    ? `${import.meta.env.BASE_URL}reference/${pkg[1]}/`
    : `${blob}${resolved}${fragment === '' ? '' : `#${fragment}`}`;
};

/**
 * The same document with those targets redirected and nothing else touched.
 *
 * Fenced blocks are stepped over, and that is a requirement rather than a
 * tidiness: this document's two fences are generated from `examples/` and
 * `pnpm docs:check` compares them byte for byte, so a fence must come out of
 * here exactly as it went in rather than come out rewritten and put the site
 * and the gate into disagreement about what the example is.
 *
 * What it handles is what `src/content.config.ts` handles for the READMEs, and
 * for the same reason — one regular expression is worth more here than a
 * parser, on a corpus two gates already read: an inline `[text](target)` whose
 * target has no spaces and no parentheses, on a line outside a fence. An image,
 * a title, an angle-bracketed target and a reference-style definition are left
 * as written, which for a relative target means a link that 404s on the site.
 * Write cross-document links as plain inline links and they are re-addressed.
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
 * A provider's page, as Markdown: what it is called, which packages it is
 * about, and the document it renders.
 *
 * @typedef {{ slug: string; title: string; packages: readonly string[]; markdown: string }} ProviderDocument
 */

/**
 * Every provider page's document, composed out of the one source.
 *
 * The slug is the title lowercased and hyphenated rather than a field of its own
 * in the table above, so the route and the page's heading cannot disagree about
 * what the page is called.
 *
 * @param {string} source
 * @param {string} repoRoot
 * @returns {ProviderDocument[]}
 */
export const providerDocuments = (source, repoRoot) => {
  const parsed = sections(source);
  const [intro] = parsed;
  if (!/^# /.test(intro.text)) {
    throw new Error(
      `${PROVIDER_SETUP_DOC} does not open with a level-one title. Its first line is what these pages drop in favour of the provider's own name as the page heading.`
    );
  }

  const providerHeadings = new Set(PROVIDERS.map((entry) => entry.heading));
  const unclassified = parsed
    .slice(1)
    .map((section) => section.heading)
    .filter(
      (heading) =>
        !providerHeadings.has(heading) && !SHARED_SECTIONS.includes(heading)
    );
  if (unclassified.length > 0) {
    // Not a section left off a page by accident, and not one silently added to
    // all four: whoever added a heading to that document knows which of the two
    // it is, and nobody reading the pages six months later would.
    throw new Error(
      `${PROVIDER_SETUP_DOC} has section(s) the provider pages cannot place: ${unclassified.map((heading) => `"${heading}"`).join(', ')}. Add each to PROVIDERS in src/provider-pages.mjs if it documents one provider, or to SHARED_SECTIONS if it applies to all of them.`
    );
  }

  const preamble = intro.text.replace(/^# .+\n*/, '');
  const shared = parsed.filter(
    (section) =>
      section.heading !== undefined && SHARED_SECTIONS.includes(section.heading)
  );
  const context = {
    blob: repositoryBlobUrl(repoRoot),
    pages: new Set(referencePackageDirs(repoRoot))
  };

  return PROVIDERS.map((provider) => {
    const section = parsed.find((entry) => entry.heading === provider.heading);
    if (section === undefined) {
      throw new Error(
        `${PROVIDER_SETUP_DOC} has no "## ${provider.heading}" section, so a provider page listed in src/provider-pages.mjs has nothing to render. Update PROVIDERS to name the heading that replaced it.`
      );
    }
    const title = provider.lead ?? provider.heading;
    return {
      slug: title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      title,
      packages: provider.packages,
      markdown: rewriteLinks(
        [
          preamble,
          providerSlice(section, provider),
          ...shared.map((entry) => entry.text)
        ].join('\n\n'),
        context
      )
    };
  });
};

/**
 * The pages, in the order `PROVIDERS` lists them, each with the rendered entry
 * the route puts on screen. `order` is stored on the entry rather than recovered
 * here, because a content collection hands entries back in whatever order its
 * store iterates and alphabetical would be a different order for no reason.
 *
 * That order is the document's and not a ranking: YouTube and Vimeo are the two
 * with sections of their own and come first there, which is also the order the
 * two a consumer is likeliest to be wiring up want to be in (#524).
 *
 * @typedef {{ slug: string; title: string; packages: readonly string[]; entry: import('astro:content').CollectionEntry<'providers'> }} ProviderPage
 * @returns {Promise<ProviderPage[]>}
 */
export const providerPages = async () => {
  const entries = await getCollection('providers');
  return entries
    .sort((a, b) => a.data.order - b.data.order)
    .map((entry) => ({
      slug: entry.id,
      title: entry.data.title,
      packages: entry.data.packages,
      entry
    }));
};
