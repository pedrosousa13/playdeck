/*
 * What each provider can tell you, read out of `docs/provider-setup.md`.
 *
 * The landing page's provider comparison argues that the five providers are not
 * interchangeable — that they genuinely differ in what is knowable about them,
 * and that Playdeck reports the difference instead of flattening it. A table
 * making that argument has to be *true*, and the only way a static page can be
 * sure it is true is to derive it from the document that is already gated.
 * `docs/provider-setup.md` is in `scripts/docs-examples.mjs`'s checked list and
 * its prose was written against a detector that was run rather than read, so a
 * figure taken out of it is a figure something else already keeps honest. A
 * hand-written capability table beside it would be a second copy no gate
 * watches, which is the drift `src/content.config.ts` (#523) and
 * `src/provider-pages.mjs` (#524) both exist to remove.
 *
 * So this module writes down no facts. It writes down which *questions* the
 * page asks — three of them, in `FACTS` below — and how the document answers
 * each one. Every host name, every URL form, every option key and every reason
 * on the rendered table is a substring of that file.
 *
 * ---- what it reuses, and what it deliberately does not ----------------------
 *
 * The slicing is `src/provider-pages.mjs`'s and is not repeated here. That
 * module already knows which providers the document covers, where each one's
 * material is, and — the part that matters most — that a `## ` section it can
 * place in neither category must fail the build rather than appear on every
 * page or on none. `providerAsymmetry` runs through `providerDocuments`, so it
 * inherits that throw exactly: a section added to that document stops this
 * table too, and stops it with the message that names the file to edit.
 *
 * `providerDocuments` hands back a composed page — preamble, then the
 * provider's own material, then the shared sections — rather than the slice on
 * its own, because a page is what #524 needed. `providerSlice` and `sections`
 * are not exported. Rather than copy either, the provider's own material is
 * recovered from the composed document by structure: it is what sits before the
 * first `## `, with the preamble dropped, and the preamble is dropped by
 * counting its blocks in the source rather than by matching its text — the
 * links in it are rewritten on the way through and the text is no longer the
 * text, but no rewriting there joins or splits a line, so the block count is
 * the same on both sides. If `provider-pages.mjs` ever exports the slice, this
 * should read it instead.
 *
 * ---- the discipline this module carries -----------------------------------
 *
 * The same one, one level down. `FACTS` names three questions and the shapes
 * the document is known to answer each of them in; a provider whose material
 * answers a question in none of those shapes throws. That is deliberate and it
 * is the whole reason this is safe to render: the alternative — a cell that
 * quietly reads empty — would be a page claiming a provider says nothing about
 * its hosts, which is a lie the build should not be able to ship. A rewritten
 * paragraph in that document either still parses or stops the site.
 *
 * `.mjs` for `src/provider-pages.mjs`'s reason: it imports that module, which
 * reaches `astro:content`, and nothing in this repository type-checks either.
 * What stands behind them is `astro build`, which runs both for real.
 */

import { PROVIDER_SETUP_DOC, providerDocuments } from './provider-pages.mjs';

/**
 * The questions the table asks, in the order it asks them.
 *
 * Written out for the reason `SHARED_SECTIONS` in `provider-pages.mjs` is:
 * a question the page asks is a decision somebody made, and deriving the set
 * from the document would only mean deriving it from a shape guessed at here
 * instead. What is not written out is any answer.
 *
 * `read` takes the provider's own material, already split into blocks, and
 * returns the reading or throws. Each one is a closed set of shapes rather than
 * a search: see the module comment.
 *
 * @typedef {'available' | 'unknown' | 'unavailable'} State
 * @typedef {{ state: State; items: readonly string[]; reason?: string }} Reading
 */

/** Every inline code span in a piece of Markdown, in order, without its ticks.
 * @param {string} text
 * @returns {string[]}
 */
const codes = (text) =>
  [...text.matchAll(/`([^`]+)`/g)].map((match) => match[1]);

/**
 * A block split into sentences, each on one line.
 *
 * The line breaks go first, and that is not tidiness: this document is wrapped
 * at eighty columns, so a phrase a shape below looks for lands with a newline
 * through it about as often as not — `cannot\nbe enumerated` is the live case,
 * and a shape that missed it would silently downgrade "unknowable" to a count.
 * A sentence is also what gets shown as a reason, and a reason has no line
 * breaks of the document's choosing in it.
 *
 * Then on a full stop followed by whitespace and something that opens a
 * sentence in this document — a capital, a backtick or a bold lead. Not on a
 * colon, because `Hosts: \`vimeo.com\`, ...` is one sentence and splitting it
 * would strip the hosts off the only clause that names them. A full stop inside
 * an inline code span (`wistia.com`, `.mp4`) is never followed by whitespace, so
 * none of them splits anything.
 *
 * @param {string} block
 * @returns {string[]}
 */
const sentences = (block) =>
  block
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=\.)\s+(?=[A-Z`*])/);

/**
 * Whether a block is a Markdown table: a pipe row followed by a delimiter row.
 *
 * @param {string} block
 * @returns {boolean}
 */
const isTable = (block) => {
  const [header, delimiter] = block.split('\n');
  return (
    header?.trimStart().startsWith('|') === true &&
    /^\s*\|[\s:|-]+\|\s*$/.test(delimiter ?? '')
  );
};

/**
 * The first cell of every body row of a table, with its ticks removed.
 *
 * The first column is the one that says what the row is about in all three
 * tables this reads — `Form` for YouTube and Vimeo, `Extension` for the pair
 * that has no host list.
 *
 * @param {string} block
 * @returns {string[]}
 */
const firstCells = (block) =>
  block
    .split('\n')
    .slice(2)
    .map((row) => row.split('|')[1]?.replaceAll('`', '').trim() ?? '')
    .filter((cell) => cell !== '');

/**
 * A block that is a bullet list.
 *
 * @param {string | undefined} block
 * @returns {boolean}
 */
const isList = (block) => block !== undefined && /^\s*[-*] /.test(block);

/** @type {readonly { key: string; question: string; read: (blocks: string[]) => Reading }[]} */
const FACTS = [
  {
    key: 'hosts',
    question: 'Which hosts it answers to',
    /*
     * Three shapes, and the middle one is the point of the whole section.
     * A provider either names its hosts (YouTube spreads them over a bullet
     * list under a colon, Vimeo puts them inline), or says its host set cannot
     * be enumerated, or says it has no host list at all. Those are three
     * genuinely different answers and the document already distinguishes them;
     * a table that printed a count for all three would be inventing agreement.
     */
    read: (blocks) => {
      for (const [index, block] of blocks.entries()) {
        for (const sentence of sentences(block)) {
          if (!/\bhosts?\b/i.test(sentence)) continue;
          if (/no host list/i.test(sentence)) {
            return { state: 'unavailable', items: [], reason: sentence };
          }
          const named = [
            ...codes(sentence),
            ...(sentence.trimEnd().endsWith(':') && isList(blocks[index + 1])
              ? codes(blocks[index + 1])
              : [])
          ];
          if (named.length === 0) continue;
          return /cannot be enumerated/i.test(sentence)
            ? { state: 'unknown', items: named, reason: sentence }
            : { state: 'available', items: named };
        }
      }
      throw new Error(unreadable('hosts'));
    }
  },
  {
    key: 'forms',
    question: 'Which source forms it reads',
    /*
     * A table of accepted shapes, or the one provider that states them in a
     * sentence instead. Both are the same answer in different prose, and both
     * are `available`: the asymmetry on this row is the count and the kind of
     * thing counted, not the state.
     */
    read: (blocks) => {
      const table = blocks.find(isTable);
      if (table !== undefined) {
        return { state: 'available', items: firstCells(table) };
      }
      const stated = /accepted paths? (?:are|is)/i;
      for (const block of blocks) {
        for (const sentence of sentences(block)) {
          const at = sentence.search(stated);
          if (at === -1) continue;
          const named = codes(sentence.slice(at));
          if (named.length > 0) return { state: 'available', items: named };
        }
      }
      throw new Error(unreadable('accepted source forms'));
    }
  },
  {
    key: 'options',
    question: 'Which options are its own',
    /*
     * `providerOptions` is keyed by provider, so a provider either has a key
     * and the document lists what it accepts, or the document says it takes
     * none. The negative is a real answer rather than a gap — the pair with no
     * key reads every option it has off `Root` — so it is `unavailable` with
     * the document's own sentence as the reason, not an empty cell.
     */
    read: (blocks) => {
      for (const block of blocks) {
        for (const sentence of sentences(block)) {
          const accepts = /`providerOptions\.\w+` accepts/.exec(sentence);
          if (accepts !== null) {
            const named = codes(sentence.slice(accepts.index)).slice(1);
            if (named.length > 0) return { state: 'available', items: named };
          }
          if (/\b(?:Neither|None|No)\b[^`]*`providerOptions`/.test(sentence)) {
            return { state: 'unavailable', items: [], reason: sentence };
          }
        }
      }
      throw new Error(unreadable('`providerOptions` keys'));
    }
  }
];

/**
 * The message a fact throws with. Named once because all three want the same
 * one, and because what it has to say is which of the two files to edit.
 *
 * @param {string} subject
 * @returns {string}
 */
const unreadable = (subject) =>
  `A provider's section of ${PROVIDER_SETUP_DOC} no longer states its ${subject} in a shape src/provider-asymmetry.mjs reads, so the landing page's provider comparison would print an empty cell where a fact belongs. Either restore the shape in that document, or teach the matching entry of FACTS the new one.`;

/**
 * A provider's own material, recovered from its composed page.
 *
 * Everything before the first `## ` is the preamble followed by the provider's
 * own section; `preambleBlocks` says how many blocks of that are preamble. See
 * the module comment for why this is a block count rather than a text match.
 *
 * @param {string} markdown
 * @param {number} preambleBlocks
 * @returns {string[]}
 */
const ownMaterial = (markdown, preambleBlocks) =>
  markdown
    .split(/^## /m)[0]
    .trim()
    .split('\n\n')
    .slice(preambleBlocks)
    .map((block) => block.trim())
    .filter((block) => block !== '');

/**
 * Every provider, and how `docs/provider-setup.md` answers each question about
 * it.
 *
 * @typedef {{
 *   slug: string;
 *   title: string;
 *   packages: readonly string[];
 *   readings: readonly Reading[];
 * }} ProviderTruth
 *
 * @param {string} source the whole of `docs/provider-setup.md`
 * @param {string} repoRoot
 * @returns {{
 *   questions: readonly string[];
 *   providers: readonly ProviderTruth[];
 * }}
 */
export const providerAsymmetry = (source, repoRoot) => {
  const preambleBlocks = source
    .split(/^## /m)[0]
    .replace(/^# .+\n+/, '')
    .trim()
    .split('\n\n').length;

  const providers = providerDocuments(source, repoRoot).map((document) => {
    const blocks = ownMaterial(document.markdown, preambleBlocks);
    if (blocks.length === 0) {
      throw new Error(
        `${PROVIDER_SETUP_DOC} left "${document.title}" with no material of its own once the shared sections were removed, so the landing page's provider comparison has nothing to read. This is src/provider-pages.mjs's slicing seen from the other side — check PROVIDERS there first.`
      );
    }
    return {
      slug: document.slug,
      title: document.title,
      packages: document.packages,
      readings: FACTS.map((fact) => fact.read(blocks))
    };
  });

  return { questions: FACTS.map((fact) => fact.question), providers };
};
