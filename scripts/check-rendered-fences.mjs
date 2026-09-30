#!/usr/bin/env node
// Proves the guarantee #523 states and #559 put the first thing in the way
// of: that the text a reader is served inside a highlighted code block is
// byte-identical to the fence or file it was generated from.
//
// `pnpm docs:check` (scripts/docs-examples.mjs) compares markdown source
// against `examples/` fixtures and never renders HTML — a green run proves the
// fences in a document match the files they were taken from, and says nothing
// about the bytes a reader is served. That held for free until #559: the
// pipeline read a fence and printed it, with nothing of this repository's in
// between. `repaintForContrast` in `apps/site/src/shiki.ts` is the first thing
// that sits between them, and it is correct today by construction — it reads
// `token.htmlStyle`, writes only two `--shiki-*` properties, and never touches
// `token.content`. Construction is not a gate: a future transformer, or an
// edit to this one, that touched `token.content` would change what a reader
// is served, and nothing else in this repository would notice.
//
// So this reads the built site rather than rendering anything itself, the
// same way `scripts/check-site-links.mjs` does and for the same reason: a
// template says the right thing on paper, and checking the output is what
// proves the bytes actually arrived. It never builds — run it as
// `pnpm test:site-fences`, from a job that has already built
// `apps/site/dist`.
//
// ---- the corpus --------------------------------------------------------
//
// Two highlighting paths feed `apps/site/dist`, described at length in
// `apps/site/src/shiki.ts`'s own header comment: Astro's `<Code>` component,
// which `src/pages/examples.astro` and `src/pages/start.astro` use to print
// real files from `examples/`, and `markdown.shikiConfig`, which colours
// every fence inside the markdown the reference, provider and guide pages
// render. Both read `htmlStyle` off the same Shiki tokens through the same
// `repaintForContrast` transformer, so a corruption in it corrupts both.
//
// The corpus this script checks a rendered block against is therefore built
// from two disjoint sets of legitimate source text: the `examples/` files
// `<Code>` is handed, and every fenced code block in the markdown that feeds
// a page. Coverage of "both paths" is proven the same way — not by which page
// a block happened to render on, which the two paths' identical markup gives
// no way to tell apart, but by which half of the corpus actually matched
// something. If either half never matches a single rendered block, one whole
// highlighting path went unexercised, or the `astro-code` markup this script
// parses changed shape underneath it — either way that is a reason to fail
// loudly rather than report a check that quietly covered only the other half.
//
// Both source lists below are explicit rather than a glob, for the reason
// `scripts/docs-examples.mjs`'s own `docs` list gives: a glob would silently
// start gating a file nobody meant to gate, and silently stop gating one that
// moved. `GUIDE_SOURCES` is a second copy of `GUIDES` in
// `apps/site/src/guide-pages.mjs`, kept in sync by hand rather than imported:
// that module's top-level `getCollection` comes from `astro:content`, which
// resolves only inside an Astro build, and this script has to run as plain
// Node. The two drifting is not a silent failure — a guide added there and
// not here fails closed, its fences reported as matching no known source,
// which is a mismatch a person reads rather than a check that stayed quiet.
//
// `EXAMPLE_SOURCES` matches `.trimEnd()`, the one transform
// `src/pages/examples.astro` and `src/pages/start.astro` apply to a file
// before handing it to `<Code>` — see each page's own `read()` helper. That is
// not a normalisation this script invented to make two sides agree: it is the
// site's own documented behaviour, restated here because this script reads
// the same files independently rather than importing that helper. Every file
// on disk ends with a trailing newline and `<Code>` never sees it, so without
// this every rendered block on `/examples` and `/start` would report a false
// mismatch of exactly one trailing newline. Nothing else is trimmed, and
// nothing about a markdown fence's body is: a fence's content is already
// whatever sits between its two fence lines, with no trailing newline of its
// own to strip, and trimming further would risk hiding a real content change
// inside the check meant to catch it.
//
// Every fenced markdown document renders whole into a page, and every
// transform this repository applies on the way — link rewriting in
// `src/content.config.ts`, `src/provider-pages.mjs` and `src/guide-pages.mjs`;
// section-splitting in `src/provider-pages.mjs`; heading demotion in
// `src/comparison-page.mjs`; Storybook-scaffolding removal in
// `src/guide-pages.mjs` — steps over a fence's own lines rather than rewriting
// them, by their own documented design. So a fence's body reaches the built
// page unchanged regardless of which page or which selection of a document it
// ends up on, and this script can read every fence out of the whole source
// document without reproducing any of that page-assembly logic.
//
// Root `README.md` is deliberately not in this corpus: `src/content.config.ts`
// loads `packages/*/README.md` and nothing at the repository root, so a fence
// in it never reaches `apps/site/dist` and has no business being legitimate
// source for something this script found there.
//
// This does not change `repaintForContrast`, `pnpm docs:check`'s existing
// source-to-source comparison, or any highlighting, theme or contrast
// behaviour — it is an addition, and touches no published package.

import { readFile, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import { publishablePackages } from './workspace-packages.mjs';

const console = globalThis.console;

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const distDir = join(repoRoot, 'apps', 'site', 'dist');

/**
 * The files `<Code>` renders, exactly as `examples.astro` and `start.astro`
 * read them: `examples/archetype-streaming-service.tsx` and
 * `examples/archetype-course-platform.tsx` for `/examples`,
 * `examples/quickstart.tsx` and `examples/react-composition.tsx` for
 * `/start`. Explicit for the reason given above `GUIDE_SOURCES`.
 * @type {readonly string[]}
 */
const EXAMPLE_SOURCES = [
  'examples/archetype-streaming-service.tsx',
  'examples/archetype-course-platform.tsx',
  'examples/quickstart.tsx',
  'examples/react-composition.tsx'
];

/**
 * `GUIDES` in `apps/site/src/guide-pages.mjs`, restated — see the header
 * comment above for why this cannot simply import that list.
 * @type {readonly string[]}
 */
const GUIDE_SOURCES = [
  'apps/storybook/stories/Contract.mdx',
  'apps/storybook/stories/CapabilitiesMatrix.mdx',
  'apps/storybook/stories/Captions.mdx',
  'apps/storybook/stories/Quality.mdx',
  'apps/storybook/stories/PlaybackRate.mdx',
  'apps/storybook/stories/Chapters.mdx',
  'apps/storybook/stories/Live.mdx',
  'apps/storybook/stories/BehaviourPlugins.mdx',
  'apps/storybook/stories/Theme.mdx'
];

/**
 * Every markdown/MDX document this script reads fences out of, except the
 * package READMEs — those come from `publishablePackages`, below, which is
 * also `src/reference-packages.mjs`'s own source of "which packages get a
 * page" and so cannot drift from it the way a second hand-kept list could.
 * @type {readonly string[]}
 */
const MARKDOWN_DOCS = [
  'docs/provider-setup.md',
  'docs/comparison/results.md',
  'docs/comparison/features.md',
  'docs/comparison/method.md',
  ...GUIDE_SOURCES
];

/**
 * HTML's five named character references that stand for a reserved markup
 * character, plus the two numeric forms — decimal and hex — Shiki (or any
 * other HTML serialiser) may use instead. One pass over the whole string
 * rather than a `replace` per entity, chained: chaining risks decoding a
 * sequence twice — `&amp;lt;` would come back as `<` instead of the four
 * characters `&lt;` the source actually contained — because the first
 * replacement's output becomes the second replacement's input. Matching every
 * entity in one pass and deciding each match's replacement independently has
 * no such second pass to go wrong in.
 */
const ENTITY = /&(?:(amp|lt|gt|quot|apos)|#(\d+)|#x([0-9a-fA-F]+));/g;

/** @type {Record<string, string>} */
const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/**
 * The characters an HTML-encoded string stands for. Exported and unit-tested
 * on its own, per the issue: a decoding bug here is a false failure, which is
 * worse than no gate — nobody should have to reason about this alongside the
 * corpus and the markup-parsing it sits inside of.
 * @param {string} text
 * @returns {string}
 */
export const decodeHtmlEntities = (text) =>
  text.replace(ENTITY, (_, named, decimal, hex) => {
    if (named !== undefined) return NAMED_ENTITIES[named];
    if (decimal !== undefined) return String.fromCodePoint(Number(decimal));
    return String.fromCodePoint(
      Number.parseInt(/** @type {string} */ (hex), 16)
    );
  });

/** An `astro-code` block's opening tag and everything up to its `</pre>`. */
const PRE_TAG = /<pre([^>]*)>([\s\S]*?)<\/pre>/g;
/**
 * One rendered source line. `class="line[^"]*"` rather than the exact
 * `class="line"` Shiki emits today, so a future modifier class (a highlighted
 * line, say) does not turn into a decoding failure that has nothing to do
 * with what this script exists to catch.
 */
const LINE_SPAN = /^<span class="line[^"]*">([\s\S]*)<\/span>$/;
/** A token's own `<span style="…">…</span>`, or the unstyled `<span>…</span>`
 * Shiki emits for a line it assigned no colour to (`plaintext`). Nested
 * `<span>`s never occur inside one of these — a token is a run of characters,
 * not markup — so stripping every tag of this shape is exact rather than an
 * approximation. */
const TOKEN_SPAN = /<\/?span[^>]*>/g;

/**
 * Every highlighted code block on one rendered page, decoded back to the text
 * a reader is served — the whole of this script's parsing surface, and so the
 * other case the issue asks to be pinned by dedicated tests.
 *
 * A `<pre>` without `astro-code` in its class list is not one of Shiki's
 * blocks and is skipped rather than inspected. So is one that carries the
 * class but no `data-language`: `apps/site/src/components/Bench.astro` calls
 * `shiki`'s `codeToHtml` directly, for the landing page's provider/skin
 * comparison, and its own `addBenchPreAttributes` transformer stamps
 * `astro-code` onto the result by hand so `base.css`'s selectors still find
 * it — but nothing there sets `data-language`, which is added only by
 * Astro's own `<Code>` integration and its markdown pipeline, the two paths
 * this script exists to check. A composed string is not a fence or a file
 * either, so there is no independent source for it to drift from the way
 * #523's guarantee is about; that third surface is outside this issue.
 * Everything else here throws rather than skips, because a shape neither of
 * those two exclusions explains is this script's contract with the rendered
 * markup breaking, and a silently empty result would be mistaken for "the
 * page has no code on it" instead.
 * @param {string} html
 * @returns {{ language: string; text: string }[]}
 */
export const renderedBlocksIn = (html) => {
  /** @type {{ language: string; text: string }[]} */
  const blocks = [];

  for (const [, attributes, inner] of html.matchAll(PRE_TAG)) {
    const classes = (/\bclass="([^"]*)"/.exec(attributes)?.[1] ?? '').split(
      /\s+/
    );
    if (!classes.includes('astro-code')) continue;

    const language = /\bdata-language="([^"]*)"/.exec(attributes)?.[1];
    if (language === undefined) continue;

    if (!inner.startsWith('<code>') || !inner.endsWith('</code>')) {
      throw new Error(
        `An astro-code block for "${language}" is not a single <code>…</code>, which this script's decoder assumes: ${inner.slice(0, 120)}…`
      );
    }
    const code = inner.slice('<code>'.length, -'</code>'.length);

    const text = code
      .split('\n')
      .map((line) => {
        const matched = LINE_SPAN.exec(line);
        if (!matched) {
          throw new Error(
            `A line inside an astro-code block for "${language}" is not a <span class="line">…</span>: ${line.slice(0, 120)}…`
          );
        }
        return decodeHtmlEntities(matched[1].replace(TOKEN_SPAN, ''));
      })
      .join('\n');

    blocks.push({ language, text });
  }

  return blocks;
};

/**
 * Every fenced code block's raw body in one markdown or MDX document — no
 * decoding, because nothing here is HTML: a fence's characters are already
 * whatever the source contains.
 *
 * The same toggle `src/content.config.ts`, `src/provider-pages.mjs` and
 * `src/guide-pages.mjs` each use to step over a fence rather than parse
 * inside it: a line matching ```` ```/~~~ ```` flips whether the lines after
 * it are being collected. An unterminated fence collects to the end of the
 * document rather than throwing, for the reason those three modules give for
 * their own version of this: a malformed fence is `pnpm docs:check`'s
 * problem to report, by failing on a fence that no longer matches its source.
 * @param {string} text
 * @returns {string[]}
 */
export const fencedBodies = (text) => {
  /** @type {string[]} */
  const bodies = [];
  /** @type {string[] | undefined} */
  let collecting;

  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      if (collecting === undefined) {
        collecting = [];
      } else {
        bodies.push(collecting.join('\n'));
        collecting = undefined;
      }
      continue;
    }
    collecting?.push(line);
  }

  return bodies;
};

/**
 * The corpus entry sharing the longest run of matching characters with
 * `text`, from the start, and the index where the two stop agreeing.
 *
 * What turns "a block mismatched" into something actionable: a corrupted
 * token almost always leaves everything before it untouched, so the entry it
 * drifted from is the one it still agrees with for longest, and the index
 * they part at is exactly where to look. `undefined` against an empty corpus
 * rather than a divergedAt of `0` against nothing, so a caller cannot mistake
 * "there was nothing to compare against" for "they differed at the very
 * first character".
 * @param {string} text
 * @param {Iterable<string>} corpus
 * @returns {{ candidate: string; divergedAt: number } | undefined}
 */
export const nearestSource = (text, corpus) => {
  /** @type {string | undefined} */
  let candidate;
  let divergedAt = -1;

  for (const entry of corpus) {
    const limit = Math.min(text.length, entry.length);
    let index = 0;
    while (index < limit && text[index] === entry[index]) index += 1;
    if (index > divergedAt) {
      divergedAt = index;
      candidate = entry;
    }
  }

  return candidate === undefined ? undefined : { candidate, divergedAt };
};

/**
 * Every rendered block, checked against the two halves of the corpus and
 * sorted into a hit for whichever half it matched or a failure if it matched
 * neither. Exported and tested with small, made-up corpora — the classifying
 * logic is what this function is, and it should not need a real build to
 * exercise.
 * @param {{ page: string; language: string; text: string }[]} blocks
 * @param {{ component: ReadonlySet<string>; markdown: ReadonlySet<string> }} corpora
 * @returns {{
 *   componentHits: number;
 *   markdownHits: number;
 *   failures: { page: string; language: string; text: string }[];
 * }}
 */
export const verifyBlocks = (blocks, corpora) => {
  let componentHits = 0;
  let markdownHits = 0;
  /** @type {{ page: string; language: string; text: string }[]} */
  const failures = [];

  for (const block of blocks) {
    if (corpora.component.has(block.text)) componentHits += 1;
    else if (corpora.markdown.has(block.text)) markdownHits += 1;
    else failures.push(block);
  }

  return { componentHits, markdownHits, failures };
};

/**
 * Every `.html` file under `directory`, repository-relative to it with `/`
 * separators — the same walk `scripts/check-site-links.mjs`'s `collectPages`
 * does, for the same reason: this reads the build's own file layout rather
 * than assuming Astro's route-to-file convention.
 * @param {string} directory
 * @returns {Promise<string[]>}
 */
const collectHtmlFiles = async (directory) => {
  const entries = await readdir(directory, {
    recursive: true,
    withFileTypes: true
  });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.html'))
    .map((entry) =>
      relative(directory, join(entry.parentPath, entry.name))
        .split(sep)
        .join('/')
    )
    .sort();
};

/**
 * A short, quoted excerpt centred on one position — long enough to see what
 * changed, short enough to read in a terminal.
 * @param {string} text
 * @param {number} at
 * @returns {string}
 */
const excerpt = (text, at) =>
  JSON.stringify(text.slice(Math.max(0, at - 40), at + 40));

/**
 * One failure, described so that "this block on this page no longer matches
 * its source" is the sentence a reader gets rather than "a block mismatched".
 * @param {{ page: string; language: string; text: string }} block
 * @param {readonly string[]} wholeCorpus
 * @returns {string}
 */
const describeFailure = (block, wholeCorpus) => {
  const nearest = nearestSource(block.text, wholeCorpus);
  if (nearest === undefined) {
    return `  ${block.page} — a ${block.language} block matches no known source at all, and the corpus is empty: ${excerpt(block.text, 0)}`;
  }
  return (
    `  ${block.page} — a ${block.language} block no longer matches its source.\n` +
    `    They agree for the first ${nearest.divergedAt} characters, then diverge:\n` +
    `      rendered: ${excerpt(block.text, nearest.divergedAt)}\n` +
    `      source:   ${excerpt(nearest.candidate, nearest.divergedAt)}`
  );
};

const main = async () => {
  const componentCorpus = new Set(
    await Promise.all(
      EXAMPLE_SOURCES.map(async (path) =>
        (await readFile(join(repoRoot, path), 'utf8')).trimEnd()
      )
    )
  );

  const markdownCorpus = new Set();
  for (const doc of MARKDOWN_DOCS) {
    const text = await readFile(join(repoRoot, doc), 'utf8');
    for (const body of fencedBodies(text)) markdownCorpus.add(body);
  }
  for (const pkg of publishablePackages(repoRoot)) {
    const text = await readFile(join(pkg.path, 'README.md'), 'utf8');
    for (const body of fencedBodies(text)) markdownCorpus.add(body);
  }

  const pages = await collectHtmlFiles(distDir).catch((error) => {
    throw new Error(
      `Could not read ${distDir} (${error instanceof Error ? error.message : String(error)}). Build the site first: pnpm exec turbo run build --filter=@playdeck/site...`
    );
  });
  if (pages.length === 0) {
    throw new Error(
      `No built pages under ${distDir}. Build the site first: pnpm exec turbo run build --filter=@playdeck/site...`
    );
  }

  /** @type {{ page: string; language: string; text: string }[]} */
  const blocks = [];
  for (const page of pages) {
    const html = await readFile(join(distDir, page), 'utf8');
    for (const block of renderedBlocksIn(html)) {
      blocks.push({ page, ...block });
    }
  }
  if (blocks.length === 0) {
    throw new Error(
      `No astro-code blocks found across ${pages.length} built pages. Either the build carries no highlighted code any more, or this script's markup assumptions no longer match what Shiki/Astro emit.`
    );
  }

  const { componentHits, markdownHits, failures } = verifyBlocks(blocks, {
    component: componentCorpus,
    markdown: markdownCorpus
  });

  /** @type {string[]} */
  const reasons = [];
  if (componentHits === 0) {
    reasons.push(
      '  No rendered block matched anything in the examples/*.tsx corpus — the <Code>-component highlighting path (/examples, /start) was not exercised, or this script no longer recognises its markup.'
    );
  }
  if (markdownHits === 0) {
    reasons.push(
      '  No rendered block matched anything in the markdown-fence corpus — the markdown.shikiConfig highlighting path (reference, provider and guide pages) was not exercised, or this script no longer recognises its markup.'
    );
  }
  if (failures.length > 0) {
    const wholeCorpus = [...componentCorpus, ...markdownCorpus];
    for (const failure of failures) {
      reasons.push(describeFailure(failure, wholeCorpus));
    }
  }

  if (reasons.length > 0) {
    throw new Error(
      `Rendered code blocks no longer prove #523's guarantee (#560):\n${reasons.join('\n\n')}`
    );
  }

  console.log(
    `Checked ${blocks.length} rendered code blocks across ${pages.length} built pages — ${componentHits} via the <Code> component, ${markdownHits} via markdown.shikiConfig, every one byte-identical to its source.`
  );
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(
      `\n${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
  }
}
