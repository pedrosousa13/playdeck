import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, URL } from 'node:url';
import { contractFaults } from './docs-contract.mjs';
import {
  DEMOS,
  DOCS_DIR,
  docsPackageDrift,
  pageFile,
  withoutComments
} from './docs-package.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

/**
 * A docs package on disk, from `{ path: text }`, removed after the test.
 * @param {import('node:test').TestContext} t
 * @param {Record<string, string>} files
 */
const tree = (t, files) => {
  const root = mkdtempSync(join(tmpdir(), 'playdeck-docs-contract-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
};

/** @param {string} title @param {string} body */
const page = (title, body = 'Text.\n') =>
  `---\ntitle: ${title}\ndescription: About ${title}.\n---\n\n${body}`;

const nav = (/** @type {string[]} */ ...pages) =>
  JSON.stringify([{ label: 'Docs', pages }]);

/**
 * The faults' messages, each prefixed with its `file:line`.
 * @param {string} root
 * @param {readonly string[]} [demos]
 */
const faults = (root, demos = ['player']) =>
  contractFaults(root, { demos: new Set(demos) }).map(
    (fault) => `${fault.file}:${fault.line} ${fault.message}`
  );

test('a package that follows the contract has no faults', (t) => {
  const root = tree(t, {
    'nav.json': nav('index.md', 'guides/a.md'),
    'index.md': page(
      'Home',
      'See [A](./guides/a.md#part) and ![grid](assets/grid.png).\n\n<!-- demo:player -->\n\n[ext](https://example.com/) and [mail](mailto:a@b.c)\n'
    ),
    'guides/a.md': page('A', 'Back [home](../index.md).\n'),
    'assets/grid.png': 'png',
    'assets/notes.md': 'not a page',
    'README.md': '# not a page <b>html</b>',
    'CHANGELOG.md': '# not a page'
  });
  assert.deepEqual(faults(root), []);
});

test('a page needs a title and a description', (t) => {
  const root = tree(t, {
    'nav.json': nav('a.md'),
    'a.md': '---\ntitle: A\n---\n\nText.\n'
  });
  assert.equal(faults(root).length, 1);
  assert.match(faults(root)[0] ?? '', /^a\.md:1 .*"description"/);
});

test('raw HTML is refused, an example marker among it', (t) => {
  const root = tree(t, {
    'nav.json': nav('a.md'),
    'a.md': page('A', 'One.\n\n<!-- example:quickstart -->\n\nTwo <b>x</b>.\n')
  });
  const found = faults(root);
  // Three, as deck.cool's loader reports it: marked reads `<b>` and `</b>` as
  // two HTML tokens.
  assert.equal(found.length, 3, found.join('\n'));
  assert.match(
    found[0] ?? '',
    /^a\.md:8 has raw HTML, <!-- example:quickstart -->/
  );
  assert.match(found[1] ?? '', /^a\.md:10 has raw HTML, <b>/);
  assert.match(found[2] ?? '', /^a\.md:10 has raw HTML, <\/b>/);
});

test('HTML inside a code span or fence is text, not HTML', (t) => {
  const root = tree(t, {
    'nav.json': nav('a.md'),
    'a.md': page('A', 'A `<video>` element.\n\n```html\n<video></video>\n```\n')
  });
  assert.deepEqual(faults(root), []);
});

test('a demo marker must stand alone and name a demo the site registers', (t) => {
  const root = tree(t, {
    'nav.json': nav('a.md'),
    'a.md': page(
      'A',
      'Inline <!-- demo:player --> marker.\n\n<!-- demo:other -->\n'
    )
  });
  const found = faults(root);
  assert.equal(found.length, 2, found.join('\n'));
  assert.match(found[0] ?? '', /not on a line of its own/);
  assert.match(found[1] ?? '', /marks demo "other"/);
});

test('links must reach a page, with an allowed scheme and no "&"', (t) => {
  const root = tree(t, {
    'nav.json': nav('a.md'),
    'a.md': page(
      'A',
      [
        '[missing](./b.md)',
        '',
        '[not md](./LICENSE)',
        '',
        '[script](javascript:alert)',
        '',
        '[host](//example.com/)',
        '',
        '[amp](https://example.com/?a=1&b=2)',
        '',
        '![outside](./image.png)',
        ''
      ].join('\n')
    )
  });
  const found = faults(root);
  assert.equal(found.length, 6, found.join('\n'));
  assert.match(found[0] ?? '', /"\.\/b\.md", which is not a page/);
  assert.match(found[1] ?? '', /"\.\/LICENSE", which is not a \.md page/);
  assert.match(found[2] ?? '', /a scheme the site does not allow/);
  assert.match(found[3] ?? '', /names no scheme/);
  assert.match(found[4] ?? '', /character reference/);
  assert.match(found[5] ?? '', /not a file under assets\//);
});

test('a label may be defined once', (t) => {
  const root = tree(t, {
    'nav.json': nav('a.md'),
    'a.md': page(
      'A',
      'See [x].\n\n[x]: https://a.example/\n[x]: https://b.example/\n'
    )
  });
  const found = faults(root);
  assert.equal(found.length, 1, found.join('\n'));
  assert.match(found[0] ?? '', /defines \[x\] a second time/);
});

test('nav.json lists every page once, and only pages', (t) => {
  const root = tree(t, {
    'nav.json': JSON.stringify([
      { label: 'Docs', pages: ['a.md', 'a.md', 'gone.md'] }
    ]),
    'a.md': page('A'),
    'b.md': page('B')
  });
  const found = faults(root);
  assert.equal(found.length, 3, found.join('\n'));
  assert.ok(found.some((line) => /lists "a\.md" a second time/.test(line)));
  assert.ok(
    found.some((line) => /lists "gone\.md", which is not a page/.test(line))
  );
  assert.ok(
    found.some((line) => /^b\.md:1 is not listed in nav\.json/.test(line))
  );
});

test('nav.json must exist and be a list of groups', (t) => {
  assert.match(
    faults(tree(t, { 'a.md': page('A') })).join('\n'),
    /nav\.json:1 is missing/
  );
  assert.match(
    faults(tree(t, { 'nav.json': '{}', 'a.md': page('A') })).join('\n'),
    /nav\.json:1 is not a list of groups/
  );
});

// Pagedeck reads frontmatter with a subset parser that strips a value's outer
// quotes and unescapes nothing, so a `"` or `\` would reach deck.cool's page
// either as written or as an escape sequence the author never meant.
test('a title or description may hold no " and no \\', (t) => {
  const root = tree(t, {
    'nav.json': nav('a.md', 'b.md'),
    'a.md': '---\ntitle: "Say \\"hi\\""\ndescription: About a.\n---\n\nText.\n',
    'b.md': '---\ntitle: B\ndescription: C:\\path\n---\n\nText.\n'
  });
  const found = faults(root);
  assert.equal(found.length, 2, found.join('\n'));
  assert.match(found[0] ?? '', /^a\.md:2 .*"title" holds/);
  assert.match(found[1] ?? '', /^b\.md:3 .*"description" holds/);
});

test('frontmatter is read as Pagedeck reads it: outer quotes stripped, nothing else', (t) => {
  const root = tree(t, {
    'nav.json': nav('a.md'),
    'a.md':
      "---\ntitle: 'Quoted: with a colon'\ndescription: plain, no quotes\n---\n\nText.\n"
  });
  assert.deepEqual(faults(root), []);
});

// The rewrite deck.cool's loader makes in the markdown needs the destination
// as written, for an image as for a link.
test('an image whose path is written with escapes is refused', (t) => {
  const root = tree(t, {
    'nav.json': nav('a.md'),
    'a.md': page('A', '![grid](assets/a\\_b.png)\n'),
    'assets/a_b.png': 'png'
  });
  const found = faults(root);
  assert.equal(found.length, 1, found.join('\n'));
  assert.match(
    found[0] ?? '',
    /"assets\/a_b\.png" in a form the loader cannot rewrite/
  );
});

test('withoutComments drops comment lines and keeps fences as they are', () => {
  assert.equal(
    withoutComments(
      [
        'One.',
        '',
        '<!-- example:a -->',
        '',
        '```html',
        '<!-- kept -->',
        '```',
        '',
        '<!--',
        '  several lines',
        '-->',
        '',
        'Two.'
      ].join('\n')
    ),
    ['One.', '', '```html', '<!-- kept -->', '```', '', 'Two.'].join('\n')
  );
});

test('withoutComments refuses text after a comment on its line', () => {
  assert.throws(
    () => withoutComments('One.\n\n<!-- note --> Two.\n'),
    /line 3 .*text after the comment/
  );
  assert.throws(
    () => withoutComments('<!--\nnote\n--> Two.\n'),
    /line 3 .*text after the comment/
  );
});

test('the generator refuses a title or description holding " or \\', () => {
  assert.throws(
    () => pageFile('guides/a.md', 'A "quoted" title', 'Fine.', 'Body.'),
    /guides\/a\.md: its title holds/
  );
  assert.throws(
    () => pageFile('guides/a.md', 'Fine', 'A C:\\path.', 'Body.'),
    /guides\/a\.md: its description holds/
  );
  assert.match(
    pageFile('guides/a.md', 'A', 'B.', 'Body.'),
    /^---\ntitle: "A"\ndescription: "B\."\n---\n\nBody\.\n$/
  );
});

test('two files cannot share a route', (t) => {
  const root = tree(t, {
    'nav.json': nav('guides.md', 'guides/index.md'),
    'guides.md': page('G'),
    'guides/index.md': page('G2')
  });
  const found = faults(root);
  assert.equal(found.length, 1, found.join('\n'));
  assert.match(found[0] ?? '', /has the route \/guides\//);
});

// The real package, against the demos deck.cool's site has agreed to register.
test('packages/docs follows the docs contract', () => {
  assert.deepEqual(
    contractFaults(join(repoRoot, DOCS_DIR), { demos: new Set(DEMOS) }),
    []
  );
});

// The generated copy is committed, so a source document, an example file or
// the generator itself changing without `pnpm docs:package` being rerun is a
// failure here -- the comparison guide's and the provider table's generated
// tables among them.
test('packages/docs is what the generator writes from its sources', () => {
  assert.deepEqual(docsPackageDrift(repoRoot), []);
});

// The acceptance criterion as npm itself answers it: markdown, nav.json,
// assets/ and package.json, and nothing else.
test('the packed package holds only markdown, nav.json, assets and its manifest', () => {
  const [packed] = JSON.parse(
    execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
      cwd: join(repoRoot, DOCS_DIR),
      encoding: 'utf8'
    })
  );
  const unexpected = packed.files
    .map((/** @type {{ path: string }} */ file) => file.path)
    .filter(
      (/** @type {string} */ path) =>
        !path.endsWith('.md') &&
        path !== 'nav.json' &&
        path !== 'package.json' &&
        // `pnpm publish` copies the repository root's LICENSE into a package
        // that has none; `npm pack` does not, but either is allowed.
        path !== 'LICENSE' &&
        !path.startsWith('assets/')
    );
  assert.deepEqual(unexpected, []);
  assert.ok(
    packed.files.length > 20,
    `only ${packed.files.length} files packed`
  );
});
