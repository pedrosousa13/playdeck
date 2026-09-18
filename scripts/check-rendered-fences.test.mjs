import assert from 'node:assert/strict';
import test from 'node:test';

import {
  decodeHtmlEntities,
  fencedBodies,
  nearestSource,
  renderedBlocksIn,
  verifyBlocks
} from './check-rendered-fences.mjs';

// ---- decodeHtmlEntities -----------------------------------------------------
//
// This is the fiddly part the issue calls out by name: a decoding bug here is
// a false failure, which is worse than no gate at all. Each named entity Shiki
// actually emits gets its own case, plus the two numeric forms, plus the one
// sequence a naive sequential decoder gets wrong.

test('decodes the five named entities Shiki emits for reserved characters', () => {
  assert.equal(decodeHtmlEntities('&lt;Player.Root /&gt;'), '<Player.Root />');
  assert.equal(decodeHtmlEntities('a &amp;&amp; b'), 'a && b');
  assert.equal(decodeHtmlEntities('&quot;hd&quot;'), '"hd"');
  assert.equal(decodeHtmlEntities('it&#39;s'), "it's");
});

test('decodes a decimal and a hex numeric entity', () => {
  assert.equal(decodeHtmlEntities('&#39;'), "'");
  assert.equal(decodeHtmlEntities('&#x27;'), "'");
});

test('leaves plain text with no entities untouched', () => {
  assert.equal(
    decodeHtmlEntities('const x: number = 1;'),
    'const x: number = 1;'
  );
});

test('decodes a literal &amp;lt; to the four characters "&lt;", not to "<"', () => {
  // A sequential decoder that replaces &lt; before &amp; turns the source
  // text `&amp;lt;` into `<` — two entities collapsed into one character that
  // was never there. This is one pass over the real syntax, so `&amp;` and
  // `lt;` are two adjacent matches and never one.
  assert.equal(decodeHtmlEntities('&amp;lt;'), '&lt;');
});

// ---- renderedBlocksIn -------------------------------------------------------
//
// Fixtures shaped like `apps/site/dist`'s real output: a `<pre class=
// "astro-code …" data-language="…"><code>` wrapping one `<span class="line">`
// per source line, tokens nested inside as `<span style="…">`.

test('decodes a single-line block back to its source text', () => {
  const html =
    '<pre class="astro-code astro-code-themes github-light github-dark" data-language="sh"><code><span class="line"><span style="--shiki-light:#6F42C1">pnpm</span><span style="--shiki-light:#032F62"> add @playdeck/core</span></span></code></pre>';
  assert.deepEqual(renderedBlocksIn(html), [
    { language: 'sh', text: 'pnpm add @playdeck/core' }
  ]);
});

test('joins multiple lines with a newline, in source order', () => {
  const html =
    '<pre class="astro-code" data-language="ts"><code>' +
    '<span class="line"><span style="c">const a = 1;</span></span>\n' +
    '<span class="line"><span style="c">const b = 2;</span></span>' +
    '</code></pre>';
  assert.deepEqual(renderedBlocksIn(html), [
    { language: 'ts', text: 'const a = 1;\nconst b = 2;' }
  ]);
});

test('renders a blank source line as an empty line, not a dropped one', () => {
  const html =
    '<pre class="astro-code" data-language="ts"><code>' +
    '<span class="line"><span style="c">const a = 1;</span></span>\n' +
    '<span class="line"></span>\n' +
    '<span class="line"><span style="c">const b = 2;</span></span>' +
    '</code></pre>';
  assert.deepEqual(renderedBlocksIn(html), [
    { language: 'ts', text: 'const a = 1;\n\nconst b = 2;' }
  ]);
});

test('decodes entities inside a token, matching the source characters', () => {
  const html =
    '<pre class="astro-code" data-language="tsx"><code>' +
    '<span class="line"><span style="c">&lt;Player.Root /&gt;</span></span>' +
    '</code></pre>';
  assert.deepEqual(renderedBlocksIn(html), [
    { language: 'tsx', text: '<Player.Root />' }
  ]);
});

test('reads an untokenised span with no style attribute, as Shiki emits for plaintext', () => {
  const html =
    '<pre class="astro-code" data-language="plaintext"><code>' +
    '<span class="line"><span>providers={{</span></span>' +
    '</code></pre>';
  assert.deepEqual(renderedBlocksIn(html), [
    { language: 'plaintext', text: 'providers={{' }
  ]);
});

test('preserves leading and trailing whitespace on a line exactly', () => {
  const html =
    '<pre class="astro-code" data-language="ts"><code>' +
    '<span class="line"><span style="c">  indented, trailing  </span></span>' +
    '</code></pre>';
  assert.deepEqual(renderedBlocksIn(html), [
    { language: 'ts', text: '  indented, trailing  ' }
  ]);
});

test('ignores a <pre> that is not an astro-code block', () => {
  const html =
    '<pre class="not-code"><code>whatever</code></pre>' +
    '<pre class="astro-code" data-language="sh"><code><span class="line"><span>pnpm i</span></span></code></pre>';
  assert.deepEqual(renderedBlocksIn(html), [
    { language: 'sh', text: 'pnpm i' }
  ]);
});

test("skips an astro-code block with no data-language, as Bench.astro's own codeToHtml calls emit", () => {
  const html =
    '<pre class="shiki shiki-themes github-light github-dark astro-code" data-bench-composition=""><code><span class="line"><span>x</span></span></code></pre>' +
    '<pre class="astro-code" data-language="sh"><code><span class="line"><span>pnpm i</span></span></code></pre>';
  assert.deepEqual(renderedBlocksIn(html), [
    { language: 'sh', text: 'pnpm i' }
  ]);
});

test('finds every astro-code block on a page, each decoded independently', () => {
  const html =
    '<p>prose</p>' +
    '<pre class="astro-code" data-language="sh"><code><span class="line"><span>pnpm add x</span></span></code></pre>' +
    '<p>more prose</p>' +
    '<pre class="astro-code" data-language="ts"><code><span class="line"><span>const x = 1;</span></span></code></pre>';
  assert.deepEqual(renderedBlocksIn(html), [
    { language: 'sh', text: 'pnpm add x' },
    { language: 'ts', text: 'const x = 1;' }
  ]);
});

// ---- fencedBodies ------------------------------------------------------------
//
// The other half of the corpus: raw, undecoded fence bodies read straight out
// of a markdown/mdx source document. Nothing here is HTML, so nothing here is
// entity-decoded — the source characters are already what they are.

test('reads one fenced block, without its fence lines', () => {
  const text = ['prose', '```ts', 'const a = 1;', '```', 'more prose'].join(
    '\n'
  );
  assert.deepEqual(fencedBodies(text), ['const a = 1;']);
});

test('reads every fenced block in a document, in order', () => {
  const text = [
    '```sh',
    'pnpm add x',
    '```',
    'prose in between',
    '```ts',
    'const a = 1;',
    '```'
  ].join('\n');
  assert.deepEqual(fencedBodies(text), ['pnpm add x', 'const a = 1;']);
});

test('keeps a blank line inside a fence as part of the body', () => {
  const text = ['```ts', 'const a = 1;', '', 'const b = 2;', '```'].join('\n');
  assert.deepEqual(fencedBodies(text), ['const a = 1;\n\nconst b = 2;']);
});

test('keeps <, >, &, and quote characters literally — nothing here is HTML', () => {
  const text = [
    '```tsx',
    '<Player.Root providerOptions={{ example: { quality: "hd" } }} />',
    "// a && b, it's fine",
    '```'
  ].join('\n');
  assert.deepEqual(fencedBodies(text), [
    [
      '<Player.Root providerOptions={{ example: { quality: "hd" } }} />',
      "// a && b, it's fine"
    ].join('\n')
  ]);
});

test('keeps leading and trailing whitespace on a fenced line exactly', () => {
  const text = ['```ts', '  indented, trailing  ', '```'].join('\n');
  assert.deepEqual(fencedBodies(text), ['  indented, trailing  ']);
});

test('reads a fence with no language tag', () => {
  const text = ['```', 'providers={{', '```'].join('\n');
  assert.deepEqual(fencedBodies(text), ['providers={{']);
});

test('reads nothing from a document with no fences', () => {
  assert.deepEqual(fencedBodies('just prose, no fences at all'), []);
});

// ---- verifyBlocks ------------------------------------------------------------

test('counts a block matching the component corpus as a component hit', () => {
  const result = verifyBlocks(
    [{ page: 'examples/index.html', language: 'tsx', text: 'const a = 1;' }],
    { component: new Set(['const a = 1;']), markdown: new Set() }
  );
  assert.equal(result.componentHits, 1);
  assert.equal(result.markdownHits, 0);
  assert.deepEqual(result.failures, []);
});

test('counts a block matching the markdown corpus as a markdown hit', () => {
  const result = verifyBlocks(
    [{ page: 'reference/core/index.html', language: 'sh', text: 'pnpm i' }],
    { component: new Set(), markdown: new Set(['pnpm i']) }
  );
  assert.equal(result.componentHits, 0);
  assert.equal(result.markdownHits, 1);
  assert.deepEqual(result.failures, []);
});

test('a block matching neither corpus is a failure, not silently ignored', () => {
  const block = {
    page: 'reference/core/index.html',
    language: 'ts',
    text: 'const a = 2;'
  };
  const result = verifyBlocks([block], {
    component: new Set(),
    markdown: new Set(['const a = 1;'])
  });
  assert.equal(result.componentHits, 0);
  assert.equal(result.markdownHits, 0);
  assert.deepEqual(result.failures, [block]);
});

// ---- nearestSource -----------------------------------------------------------

test('finds the corpus entry sharing the longest prefix, and where they part', () => {
  const result = nearestSource('const a = 2;', [
    'const a = 1;',
    'totally unrelated text'
  ]);
  assert.equal(result?.candidate, 'const a = 1;');
  assert.equal(result?.divergedAt, 10); // "const a = " matches, "2" vs "1" differs
});

test('returns undefined against an empty corpus', () => {
  assert.equal(nearestSource('anything', []), undefined);
});
