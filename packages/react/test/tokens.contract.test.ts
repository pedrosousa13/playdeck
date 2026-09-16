// @vitest-environment node
// Reads files off disk rather than rendering anything, and happy-dom's global
// `URL` cannot resolve `import.meta.url` into a file path -- the same reason
// theme.test.ts and apps/storybook/stories/parts.contract.test.ts both open
// with this pragma.

import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { tokenDefault, withoutPhoneDockingBlock } from './token-default';

// The token contract in packages/react/README.md is the versioned document
// (#666): every `--playdeck-*` token's name, role, default and the parts that
// read it. This file is the two-way check that keeps it honest against what
// `theme.css`, `docked.css` and the primitives themselves actually do --
// following apps/storybook/stories/parts.contract.test.ts's shape (derive
// both sides from source, assert each direction separately, name the
// offending token in the message) for the same reason that file gives: a
// hand-maintained table goes stale silently, and prose cannot say otherwise.
//
// "Read" here is wider than the two stylesheets alone. `--playdeck-poster-fit`,
// `--playdeck-poster-position`, `--playdeck-control-min-size`,
// `--playdeck-seek-slider-min-block-size` and the four `--playdeck-caption-*`
// tokens are read only inline, by the primitive that owns the part -- never by
// `theme.css` or `docked.css` -- which is exactly what CONTEXT.md's own Token
// entry describes ("a primitive reads inline with a fallback"). Scoping this
// scan to the two stylesheets alone would leave those ten permanently
// undocumentable: nothing would ever confirm they are read at all, and the
// README's own existing mention of "the `--playdeck-caption-*` tokens" would
// keep being the only place they are named. So this scan covers both
// stylesheets and every `.ts`/`.tsx` file under `packages/react/src`.

const reactDir = fileURLToPath(new URL('..', import.meta.url));

const stripCssComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '');

// `//` only outside a `:` (so `https://` in a string is left alone) -- cheap
// and sufficient here because nothing this scan needs to see sits after a
// `//` inside a string in these files, verified by the token list this
// produces matching a manual read of every file it touches.
const stripJsComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const partAttrSingle = /data-playdeck-part='([^']+)'/g;
const partAttrDouble = /data-playdeck-part="([^"]+)"/g;
// A bare `[data-playdeck-part]`, with no `='...'` value, selects every part
// that carries the attribute -- `--playdeck-color-focus`'s focus-visible
// outline and one of `--playdeck-control-icon-size`'s two rules read this
// way. Represented as the sentinel part `*`, which the README table also
// writes for exactly those two tokens.
const universalPartAttr = /\[data-playdeck-part\](?!=)/;
const tokenRead = /var\(\s*(--playdeck-[a-zA-Z0-9-]+)/g;

type TokenReads = Map<string, Set<string>>;

const addRead = (reads: TokenReads, token: string, part: string): void => {
  const parts = reads.get(token) ?? new Set<string>();
  parts.add(part);
  reads.set(token, parts);
};

/**
 * Every rule in a `@layer`/`@media`-nested stylesheet, as a selector and its
 * declaration body -- walked recursively so a rule inside `@media (forced-
 * colors: none) { @media (prefers-color-scheme: dark) { ... } }` (docked.css's
 * own nesting) is reached at any depth. Paren-depth tracked while hunting the
 * next `{` because a selector can hold one (`:where(a, b)`); none of these
 * two files ever put a `{` inside a selector's parens.
 */
const cssRules = (
  text: string
): readonly { readonly selector: string; readonly body: string }[] => {
  const rules: { selector: string; body: string }[] = [];
  let i = 0;
  while (i < text.length) {
    let depth = 0;
    let j = i;
    for (; j < text.length; j++) {
      const c = text[j];
      if (c === '(') depth++;
      else if (c === ')') depth--;
      else if (c === '{' && depth === 0) break;
    }
    if (j >= text.length) break;
    const prelude = text.slice(i, j).trim();
    let braceDepth = 1;
    let k = j + 1;
    for (; k < text.length && braceDepth > 0; k++) {
      if (text[k] === '{') braceDepth++;
      else if (text[k] === '}') braceDepth--;
    }
    const body = text.slice(j + 1, k - 1);
    if (prelude.startsWith('@')) {
      rules.push(...cssRules(body));
    } else {
      rules.push({ selector: prelude, body });
    }
    i = k;
  }
  return rules;
};

const addCssReads = (reads: TokenReads, source: string): void => {
  for (const { selector, body } of cssRules(stripCssComments(source))) {
    const parts = new Set(
      [...selector.matchAll(partAttrSingle)].map(([, part]) => part)
    );
    if (parts.size === 0 && universalPartAttr.test(selector)) parts.add('*');
    if (parts.size === 0) continue;
    for (const [, token] of body.matchAll(tokenRead)) {
      for (const part of parts) addRead(reads, token, part);
    }
  }
};

/**
 * `const NAME = { ... }` and `const NAME = '...'` style objects/constants
 * across every source file, keyed by name, holding whichever `--playdeck-*`
 * tokens their body reads. `controlTargetStyle`, `captionCueBoxStyle`,
 * `activationOverlayStyle` and `SEEK_SLIDER_MIN_BLOCK_SIZE` are the ones this
 * package actually has; nothing here is specific to their names. Only a const
 * whose declaration is a `{ ... }` object or a same-statement value up to its
 * first `;` is captured -- a destructuring `const { a, b } = x` never matches
 * `const\s+IDENT`, and an arrow function whose body reads a token would be
 * over-captured by the same up-to-`;` rule, but no source file in this
 * package has one: every token-reading const here is an object or a plain
 * string.
 */
const styleConsts = (text: string): Map<string, Set<string>> => {
  const consts = new Map<string, Set<string>>();
  const re =
    /(?:export\s+)?const\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s*:\s*CSSProperties)?\s*=\s*/g;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    const name = m[1] as string;
    const rest = text.slice(re.lastIndex);
    let body: string;
    if (rest.trimStart().startsWith('{')) {
      const offset = rest.indexOf('{');
      let depth = 1;
      let k = offset + 1;
      for (; k < rest.length && depth > 0; k++) {
        if (rest[k] === '{') depth++;
        else if (rest[k] === '}') depth--;
      }
      body = rest.slice(offset, k);
    } else {
      const semi = rest.indexOf(';');
      body = semi === -1 ? rest : rest.slice(0, semi);
    }
    const tokens = new Set(
      [...body.matchAll(tokenRead)].map(([, token]) => token)
    );
    if (tokens.size > 0) consts.set(name, tokens);
  }
  return consts;
};

/**
 * Every JSX opening tag's own text, brace-depth aware so a multi-line
 * `style={{ ... }}` or an `onClick={(event) => { ... }}` does not end the tag
 * early at their own `}`. A closing tag, a fragment, and anything that is not
 * a tag name are skipped without being scanned.
 */
const jsxTags = (text: string): readonly string[] => {
  const tags: string[] = [];
  let i = 0;
  while (i < text.length) {
    const lt = text.indexOf('<', i);
    if (lt === -1) break;
    const next = text[lt + 1];
    if (
      next === undefined ||
      next === '/' ||
      next === '>' ||
      !/[A-Za-z]/.test(next)
    ) {
      i = lt + 1;
      continue;
    }
    let depth = 0;
    let k = lt + 1;
    for (; k < text.length; k++) {
      const c = text[k];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) break;
    }
    if (k >= text.length) break;
    tags.push(text.slice(lt, k + 1));
    i = k + 1;
  }
  return tags;
};

const addTsxReads = (
  reads: TokenReads,
  texts: ReadonlyMap<string, string>
): void => {
  const consts = new Map<string, Set<string>>();
  for (const text of texts.values()) {
    for (const [name, tokens] of styleConsts(text)) {
      const existing = consts.get(name) ?? new Set<string>();
      for (const token of tokens) existing.add(token);
      consts.set(name, existing);
    }
  }

  for (const text of texts.values()) {
    for (const tag of jsxTags(text)) {
      const parts = [...tag.matchAll(partAttrDouble)].map(([, part]) => part);
      if (parts.length === 0) continue;
      const tokens = new Set(
        [...tag.matchAll(tokenRead)].map(([, token]) => token)
      );
      for (const [name, constTokens] of consts) {
        if (new RegExp(`\\b${name}\\b`).test(tag)) {
          for (const token of constTokens) tokens.add(token);
        }
      }
      for (const part of parts) {
        for (const token of tokens) addRead(reads, token, part);
      }
    }
  }
};

const themeSource = await readFile(join(reactDir, 'theme.css'), 'utf8');
const dockedSource = await readFile(join(reactDir, 'docked.css'), 'utf8');

const srcDir = join(reactDir, 'src');
const srcFiles = (
  await readdir(srcDir, { recursive: true, withFileTypes: true })
)
  .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
  .map((entry) => join(entry.parentPath, entry.name));

const srcTexts = new Map<string, string>(
  await Promise.all(
    srcFiles.map(
      async (path) =>
        [
          relative(srcDir, path),
          stripJsComments(await readFile(path, 'utf8'))
        ] as const
    )
  )
);

const actualReads: TokenReads = new Map();
addCssReads(actualReads, themeSource);
addCssReads(actualReads, dockedSource);
addTsxReads(actualReads, srcTexts);

// ---------------------------------------------------------------------------
// The README's own side: the `| Group | Token | Default | ... |` contract
// table between the `## Theming` heading and the next `## ` heading.

const readmePath = new URL('../README.md', import.meta.url);
const readme = await readFile(readmePath, 'utf8');

const theming = /^## Theming\n([\s\S]*?)(?=\n## )/m.exec(readme)?.[1];
if (theming === undefined) {
  throw new Error('packages/react/README.md has no ## Theming section.');
}

type DocumentedToken = {
  readonly default: string;
  readonly parts: ReadonlySet<string>;
};

const documented = new Map<string, DocumentedToken>();
for (const line of theming.split('\n')) {
  if (!line.startsWith('|')) continue;
  const cells = line
    .split('|')
    .slice(1, -1)
    .map((cell) => cell.trim());
  if (cells.length !== 5) continue;
  const [, tokenCell, , defaultCell, partsCell] = cells as [
    string,
    string,
    string,
    string,
    string
  ];
  const token = /^`(--playdeck-[a-zA-Z0-9-]+)`$/.exec(tokenCell)?.[1];
  if (token === undefined) continue; // the header row and the `---` rule
  const defaultValue = /`([^`]+)`/.exec(defaultCell)?.[1];
  if (defaultValue === undefined) {
    throw new Error(
      `${token}'s Default cell in the README's Theming table carries no backtick-quoted value.`
    );
  }
  const parts = new Set(
    [...partsCell.matchAll(/`([^`]+)`/g)].map(([, part]) => part)
  );
  documented.set(token, { default: defaultValue, parts });
}

describe('the token table in packages/react/README.md is the whole contract', () => {
  it('derives a non-empty set from each side', () => {
    // The same vacuous-pass guard parts.contract.test.ts opens with: an empty
    // `actualReads` would make "every documented token is read" trivially
    // true, and an empty `documented` the same for its converse.
    expect(
      actualReads.size,
      'No token reads were found across theme.css, docked.css and packages/react/src -- the scan broke, which says nothing about the contract.'
    ).toBeGreaterThan(0);
    expect(
      documented.size,
      "No rows were read out of the README's ## Theming table -- the table or its heading changed shape, which says nothing about the contract."
    ).toBeGreaterThan(0);
  });

  it('the README documents every token the stylesheets and primitives read', () => {
    const undocumented = [...actualReads.keys()]
      .filter((token) => !documented.has(token))
      .sort()
      .map(
        (token) =>
          `${token} is read (theme.css, docked.css, or a primitive in packages/react/src) but missing from the ## Theming table in packages/react/README.md.`
      );
    expect(undocumented).toEqual([]);
  });

  it('the README names no token that nothing reads', () => {
    const phantom = [...documented.keys()]
      .filter((token) => !actualReads.has(token))
      .sort()
      .map(
        (token) =>
          `${token} is listed in the ## Theming table in packages/react/README.md but neither stylesheet nor any primitive in packages/react/src reads it.`
      );
    expect(phantom).toEqual([]);
  });

  it("each documented token's Parts column matches the selectors that actually read it", () => {
    const mismatched: string[] = [];
    for (const [token, { parts: documentedParts }] of documented) {
      const actualParts = actualReads.get(token);
      if (actualParts === undefined) continue; // reported by the previous test
      const missing = [...actualParts]
        .filter((part) => !documentedParts.has(part))
        .sort();
      const extra = [...documentedParts]
        .filter((part) => !actualParts.has(part))
        .sort();
      if (missing.length > 0) {
        mismatched.push(
          `${token} is read by \`${missing.join('`, `')}\` as well, not documented in its Parts column.`
        );
      }
      if (extra.length > 0) {
        mismatched.push(
          `${token}'s Parts column names \`${extra.join('`, `')}\`, which no selector or primitive actually reads it for.`
        );
      }
    }
    expect(mismatched.sort()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The Default column, checked against reality for every token this repo's own
// `tokenDefault` (packages/react/test/token-default.ts, extracted from
// theme.test.ts rather than re-implemented here) can read a single fallback
// for. Two tokens are excluded, both for reasons this repo's own source
// creates rather than anything about the check:
//
// `--playdeck-radius`: theme.css itself is inconsistent. Every button-shaped
// control reads it with a `0.625rem` fallback where every other rule reads
// `0.375rem` -- a real, pre-existing mismatch this contract records in prose
// (see the README row) rather than silently resolving, and out of scope to
// fix here (issue #666 excludes any visual change to the shipped
// stylesheets).
//
// `--playdeck-color-hairline`: read only by docked.css, which repeats every
// colour default inside a `prefers-color-scheme: dark` block by design --
// this token genuinely has two real defaults, and `tokenDefault` is built to
// throw on exactly that rather than silently pick one.
const DEFAULT_CHECK_EXCLUDED = new Set([
  '--playdeck-radius',
  '--playdeck-color-hairline'
]);

// theme.css only, not docked.css: docked.css intentionally gives most colour
// tokens a second default (light in the cascade's normal position, dark
// inside its `prefers-color-scheme: dark` block), which the README records by
// pointing at that file's own header rather than restating -- including
// docked.css here would make `tokenDefault` throw on every one of them.
const defaultCorpus =
  withoutPhoneDockingBlock(stripCssComments(themeSource)) +
  '\n' +
  [...srcTexts.values()].join('\n');

// theme.css wraps the font stack's fallback across several lines; the README
// states it on one. `tokenDefault` takes the fallback text whole (nested
// parens and all) and does not otherwise normalise it, so the comparison
// collapses runs of whitespace on both sides rather than asking either source
// to match the other's line breaks.
const normalizeWhitespace = (value: string): string =>
  value.replace(/\s+/g, ' ').trim();

describe("the README's Default column matches theme.css and the primitives", () => {
  for (const [token, { default: documentedDefault }] of documented) {
    if (DEFAULT_CHECK_EXCLUDED.has(token)) continue;
    it(`${token}`, () => {
      expect(
        normalizeWhitespace(
          tokenDefault(defaultCorpus, token, 'theme.css + src')
        )
      ).toBe(normalizeWhitespace(documentedDefault));
    });
  }
});
