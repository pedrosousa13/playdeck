#!/usr/bin/env node
// Writes `packages/docs` (`@playdeck/docs`): the pages of playdeck.video as
// the markdown deck.cool's site builds them from, in the shape its docs
// contract asks for (`docs/docs-contract.md` in pedrosousa13/deck-cool).
// `--check` writes nothing and fails if the committed copy is not what this
// would write.
//
// It is a generated copy, and the sources stay where they are: a package's
// README has to ship in its own tarball, the guides are the workbench's own
// `Overview/*` MDX, `docs/provider-setup.md` and `docs/comparison/` are read
// and gated where they sit, and `examples/` is compiled by the `examples`
// project. So nothing here is written twice. Each page is composed from those
// sources by the same modules `apps/site` renders them with -- which sections
// of `docs/provider-setup.md` reach which provider page, what comes off a
// Storybook MDX -- handed a link target that is a relative `.md` page rather
// than a route of that site.
//
// Two things the contract refuses come off on the way through, and nothing
// else is touched:
//
// - HTML comments, which are `scripts/docs-examples.mjs`'s `example:` markers
//   and the generated-file notes in `docs/comparison/`. A demo marker is the
//   only HTML the contract allows. The fences those markers wrap are copied
//   byte for byte, and `pnpm docs:check` checks them where they are generated.
// - The anchors `src/comparison-page.mjs` writes above each part of the
//   comparison guide, which are raw HTML too.
//
// The prose of the five pages `apps/site` writes in Astro -- start, examples
// and the three indexes -- is held here, in the page functions below, and
// each value those pages compute (the install command, the peers, the
// providers and their adapters, the guides' sections) is computed the same
// way. The byte figures `/start` measures off built artifacts are left out:
// they need a build, they move with the Node version doing the gzipping, and
// this has to run in CI's `static` job, which builds nothing.
//
// Until `apps/site` retires, an edit to one of those five Astro pages is also
// an edit to its function here. Nothing checks the two against each other.

import {
  readFileSync,
  readdirSync,
  rmSync,
  mkdirSync,
  writeFileSync
} from 'node:fs';
import { basename, dirname, join, posix, relative, sep } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { codePackages } from './workspace-packages.mjs';

/**
 * One of `apps/site`'s document modules, loaded by a computed URL so that the
 * `scripts` project's `tsc` does not follow it: those modules belong to the
 * site, which type-checks none of its `.mjs` (see `apps/site/tsconfig.json`).
 * What this file uses of them is typed below instead.
 * @param {string} name
 * @returns {Promise<any>}
 */
const siteModule = (name) =>
  import(new URL(`../apps/site/src/${name}`, import.meta.url).href);

/** @typedef {(dir: string, fragment?: string) => string} ReferenceHref */
/** @typedef {{ state: string; items: readonly string[]; reason?: string }} Reading */

/** @type {{ GUIDES: readonly { file: string; slug: string }[]; guideDocument: (source: string, file: string, pages: ReadonlySet<string>, referenceHref: ReferenceHref) => { title: string; markdown: string } }} */
const { GUIDES, guideDocument } = await siteModule('guide-pages.mjs');
/** @type {{ providerDocuments: (source: string, repoRoot: string, referenceHref: ReferenceHref) => { slug: string; title: string; packages: readonly string[]; markdown: string }[] }} */
const { providerDocuments } = await siteModule('provider-pages.mjs');
/** @type {{ providerAsymmetry: (source: string, repoRoot: string, referenceHref: ReferenceHref) => { questions: readonly string[]; providers: readonly { slug: string; title: string; packages: readonly string[]; readings: readonly Reading[] }[] } }} */
const { providerAsymmetry } = await siteModule('provider-asymmetry.mjs');
/** @type {{ comparisonDocument: (repoRoot: string, referenceHref: ReferenceHref) => { title: string; markdown: string } }} */
const { comparisonDocument } = await siteModule('comparison-page.mjs');

const console = globalThis.console;
const process = globalThis.process;
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

/** Where the package is, relative to the repository root. */
export const DOCS_DIR = 'packages/docs';

/**
 * The demos the pages mark, which deck.cool's site registers by these names.
 * A new one is agreed with that site before a release carries it.
 */
export const DEMOS = ['streaming-service', 'course-platform'];

/** The origin `apps/site` is published at, as the READMEs link to it. */
const SITE = 'https://playdeck.video/';

const PROVIDER_SETUP_DOC = 'docs/provider-setup.md';

/**
 * Files in the package that are kept by hand rather than generated, and so are
 * neither written nor checked here.
 */
const KEPT = new Set(['package.json', 'CHANGELOG.md']);

/** @param {string} line */
const isFence = (line) => /^\s*(```|~~~)/.test(line);

/**
 * The document with every HTML comment outside a fence taken out, and the run
 * of blank lines it leaves folded to one. Fenced lines are passed through
 * untouched.
 * @param {string} markdown
 * @returns {string}
 */
export const withoutComments = (markdown) => {
  /** @type {string[]} */
  const kept = [];
  let fenced = false;
  let comment = false;
  for (const line of markdown.split('\n')) {
    if (!comment && isFence(line)) fenced = !fenced;
    if (fenced) {
      kept.push(line);
      continue;
    }
    if (comment) {
      if (line.includes('-->')) comment = false;
      continue;
    }
    if (/^\s*<!--/.test(line)) {
      comment = !line.includes('-->');
      continue;
    }
    if (line.trim() === '' && kept.at(-1)?.trim() === '') continue;
    kept.push(line);
  }
  return kept.join('\n').trim();
};

/**
 * The document without its level-one title, which the frontmatter carries
 * instead: the contract's site shows `title` as the heading and drops a
 * leading `#`.
 * @param {string} markdown
 */
const withoutTitle = (markdown) => markdown.replace(/^# .+\n+/, '');

/**
 * The page's file, from `title`, `description` and a body.
 * @param {string} title
 * @param {string} description
 * @param {string} body
 */
const page = (title, description, body) =>
  [
    '---',
    `title: ${JSON.stringify(title)}`,
    `description: ${JSON.stringify(description)}`,
    '---',
    '',
    body.trim(),
    ''
  ].join('\n');

/**
 * The path from `from`'s directory to `to`, both package paths, written the
 * way the contract's examples write one (`./a.md`, `../b.md`).
 * @param {string} from
 * @param {string} to
 */
const relativePage = (from, to) => {
  const path = posix.relative(posix.dirname(from), to);
  return path.startsWith('.') ? path : `./${path}`;
};

/**
 * The page a path on `apps/site` is in this package, or `undefined` for a
 * route this package has no page for.
 * @param {string} path the path after the origin, such as `guides/contract/`
 * @param {ReadonlySet<string>} pages
 */
const pageForRoute = (path, pages) => {
  const trimmed = path.replace(/\/$/, '');
  const candidates =
    trimmed === '' ? [] : [`${trimmed}.md`, `${trimmed}/index.md`];
  return candidates.find((candidate) => pages.has(candidate));
};

/**
 * Every inline link outside a fence, each target handed to `rewrite`. The same
 * reading of a link `apps/site`'s modules make: `[text](target)` with no
 * spaces or parentheses in the target.
 * @param {string} markdown
 * @param {(target: string) => string} rewrite
 */
const rewriteLinks = (markdown, rewrite) => {
  let fenced = false;
  return markdown
    .split('\n')
    .map((line) => {
      if (isFence(line)) {
        fenced = !fenced;
        return line;
      }
      return fenced
        ? line
        : line.replace(
            /(?<!!)\]\(([^()\s]+)\)/g,
            (_, target) => `](${rewrite(target)})`
          );
    })
    .join('\n');
};

/**
 * A link to `apps/site` pointed at this package's page for the same route,
 * from the page at `file`. Any other target is returned as it is.
 * @param {string} file
 * @param {ReadonlySet<string>} pages
 * @returns {(target: string) => string}
 */
const siteLinks = (file, pages) => (target) => {
  if (!target.startsWith(SITE)) return target;
  const [path = '', fragment] = target.slice(SITE.length).split('#');
  const found = pageForRoute(path, pages);
  return found === undefined
    ? target
    : `${relativePage(file, found)}${fragment === undefined ? '' : `#${fragment}`}`;
};

/**
 * A reference page's link to another package, from a page one directory down.
 * @param {string} dir
 * @param {string} [fragment]
 */
const referenceHref = (dir, fragment = '') =>
  `../reference/${dir}.md${fragment}`;

/**
 * The first sentence of a document's first paragraph, as a page description:
 * links reduced to their text and emphasis to its words.
 * @param {string} markdown
 * @param {string} file for the error
 */
const firstSentence = (markdown, file) => {
  const paragraph = markdown
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .find((block) => /^[A-Za-z`*_[]/.test(block));
  if (paragraph === undefined) {
    throw new Error(
      `${file} has no paragraph to describe its page with. Give it an opening paragraph.`
    );
  }
  const text = paragraph
    .replace(/\s*\n\s*/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*|__/g, '');
  const end = /[.!?](?=\s|$)/.exec(text);
  return end === null ? text : text.slice(0, end.index + 1);
};

/**
 * The `## ` headings of a document outside its fences.
 * @param {string} markdown
 */
const sectionHeadings = (markdown) => {
  /** @type {string[]} */
  const found = [];
  let fenced = false;
  for (const line of markdown.split('\n')) {
    if (isFence(line)) fenced = !fenced;
    const heading = fenced ? null : /^## (.+)$/.exec(line);
    if (heading?.[1] !== undefined) found.push(heading[1]);
  }
  return found;
};

/**
 * A table cell's text, with the characters that would end the cell or the row
 * escaped.
 * @param {string} text
 */
const cell = (text) => text.replaceAll('|', '\\|').replace(/\s*\n\s*/g, ' ');

/** @param {string} path */
const readSource = (path) =>
  readFileSync(join(repoRoot, path), 'utf8').trimEnd();

/**
 * A fence holding a file from `examples/`, as it is on disk, and the path it
 * was printed from.
 * @param {string} path
 */
const exampleFence = (path) =>
  ['```tsx', readSource(path), '```', '', `\`${path}\``].join('\n');

/**
 * @param {string} root
 * @returns {{ dir: string; name: string; description: string; manifest: Record<string, any> }[]}
 */
const referencePackages = (root) =>
  codePackages(root)
    .map((pkg) => {
      const manifest = JSON.parse(
        readFileSync(join(pkg.path, 'package.json'), 'utf8')
      );
      return {
        dir: basename(pkg.path),
        name: pkg.name,
        description: String(manifest.description),
        manifest
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

/**
 * Every file the package holds that this writes, by its path in the package.
 * @param {string} root
 * @returns {Map<string, string>}
 */
export const docsPackage = (root) => {
  const packages = referencePackages(root);
  const dirs = new Set(packages.map((pkg) => pkg.dir));
  const byDir = new Map(packages.map((pkg) => [pkg.dir, pkg]));
  const providerSource = readFileSync(join(root, PROVIDER_SETUP_DOC), 'utf8');
  const providers = providerDocuments(providerSource, root, referenceHref);
  const guides = GUIDES.map(({ file, slug }) => ({
    file,
    slug,
    ...guideDocument(
      readFileSync(join(root, file), 'utf8'),
      file,
      dirs,
      referenceHref
    )
  }));
  const comparison = comparisonDocument(root, referenceHref);

  const pagePaths = {
    start: 'start.md',
    examples: 'examples.md',
    guidesIndex: 'guides/index.md',
    guide: (/** @type {string} */ slug) => `guides/${slug}.md`,
    comparison: 'guides/comparison.md',
    referenceIndex: 'reference/index.md',
    reference: (/** @type {string} */ dir) => `reference/${dir}.md`,
    providersIndex: 'providers/index.md',
    provider: (/** @type {string} */ slug) => `providers/${slug}.md`
  };

  const nav = [
    { label: 'Start', pages: [pagePaths.start] },
    {
      label: 'Guides',
      pages: [
        pagePaths.guidesIndex,
        ...guides.map((guide) => pagePaths.guide(guide.slug)),
        pagePaths.comparison
      ]
    },
    {
      label: 'Reference',
      pages: [
        pagePaths.referenceIndex,
        ...packages.map((pkg) => pagePaths.reference(pkg.dir))
      ]
    },
    {
      label: 'Providers',
      pages: [
        pagePaths.providersIndex,
        ...providers.map((provider) => pagePaths.provider(provider.slug))
      ]
    },
    { label: 'Examples', pages: [pagePaths.examples] }
  ];
  const pages = new Set(nav.flatMap((group) => group.pages));

  /** @type {Map<string, string>} */
  const files = new Map();
  /**
   * @param {string} file
   * @param {string} title
   * @param {string} description
   * @param {string} body
   */
  const add = (file, title, description, body) => {
    files.set(
      file,
      page(title, description, rewriteLinks(body, siteLinks(file, pages)))
    );
  };

  // ---- reference -------------------------------------------------------

  for (const pkg of packages) {
    const file = pagePaths.reference(pkg.dir);
    const slug = /github\.com\/(.+?)(?:\.git)?$/.exec(
      pkg.manifest.repository?.url ?? ''
    )?.[1];
    if (slug === undefined) {
      throw new Error(
        `packages/${pkg.dir}/package.json has no GitHub repository URL to point its README's relative links at.`
      );
    }
    const blob = `https://github.com/${slug}/blob/main/`;
    const readme = readFileSync(
      join(root, 'packages', pkg.dir, 'README.md'),
      'utf8'
    );
    // As `src/content.config.ts` addresses a README on the site: a link to
    // another package's README becomes that package's page, and a target
    // relative to the package becomes the file on GitHub, because the package
    // directory is not what this publishes.
    const body = rewriteLinks(
      withoutTitle(withoutComments(readme)),
      (target) => {
        if (target.startsWith(blob)) {
          const other = /^packages\/([^/]+)\/README\.md(#.+)?$/.exec(
            target.slice(blob.length)
          );
          return other?.[1] !== undefined && dirs.has(other[1])
            ? `./${other[1]}.md${other[2] ?? ''}`
            : target;
        }
        const relativeToPackage =
          !/^[a-z][a-z0-9+.-]*:/i.test(target) &&
          !target.startsWith('/') &&
          !target.startsWith('#');
        return relativeToPackage
          ? `${blob}packages/${pkg.dir}/${target}`
          : target;
      }
    );
    add(file, pkg.name, pkg.description, body);
  }

  const scope = '@playdeck/';
  add(
    pagePaths.referenceIndex,
    'Reference',
    'Every published package, from the README that ships inside its own npm tarball.',
    [
      'Every published package, from the README that ships inside its own npm tarball.',
      '',
      `New to the library? [Start](${relativePage(pagePaths.referenceIndex, pagePaths.start)}) is one package, one composition, and what each provider needs.`,
      '',
      `Published under \`${scope}\`.`,
      '',
      ...packages.map(
        (pkg) =>
          `- [\`${pkg.name}\`](${relativePage(pagePaths.referenceIndex, pagePaths.reference(pkg.dir))}) — ${pkg.description}`
      )
    ].join('\n')
  );

  // ---- guides ----------------------------------------------------------

  for (const guide of guides) {
    const body = withoutTitle(withoutComments(guide.markdown));
    add(
      pagePaths.guide(guide.slug),
      guide.title,
      firstSentence(body, guide.file),
      body
    );
  }

  add(
    pagePaths.comparison,
    comparison.title,
    'How Playdeck compares with other React video libraries: the measured figures, the features, and the method behind both.',
    withoutTitle(
      withoutComments(
        // The anchors `comparisonDocument` puts above each of its three parts,
        // raw HTML the contract refuses. Each part's own heading follows it.
        comparison.markdown.replace(/^<a id="[a-z-]+"><\/a>$/gm, '')
      )
    )
  );

  add(
    pagePaths.guidesIndex,
    'Guides',
    'What the parts are, what each provider can answer, how captions are drawn, and what the optional stylesheet does.',
    [
      'What the parts are, what each provider can answer, how captions are drawn, and what the optional stylesheet does.',
      '',
      ...[
        ...guides.map((guide) => ({
          title: guide.title,
          file: pagePaths.guide(guide.slug),
          sections: sectionHeadings(guide.markdown)
        })),
        {
          title: comparison.title,
          file: pagePaths.comparison,
          sections: sectionHeadings(withoutComments(comparison.markdown))
        }
      ].flatMap(({ title, file, sections }) => [
        `## [${title}](${relativePage(pagePaths.guidesIndex, file)})`,
        '',
        sections.join(' · '),
        ''
      ])
    ].join('\n')
  );

  // ---- providers -------------------------------------------------------

  /** @param {readonly string[]} adapterDirs @param {string} from @param {string} title */
  const adapters = (adapterDirs, from, title) =>
    adapterDirs.map((dir) => {
      const pkg = byDir.get(dir);
      if (pkg === undefined) {
        throw new Error(
          `The ${title} setup page names packages/${dir}, which has no reference page. Update PROVIDERS in apps/site/src/provider-pages.mjs, or check that the package is still publishable.`
        );
      }
      return {
        ...pkg,
        link: `[\`${pkg.name}\`](${relativePage(from, pagePaths.reference(dir))})`
      };
    });

  for (const provider of providers) {
    const file = pagePaths.provider(provider.slug);
    const links = adapters(provider.packages, file, provider.title).map(
      (pkg) => pkg.link
    );
    add(
      file,
      provider.title,
      `Setup for ${provider.title}: the source values accepted and refused, and the provider's own options.`,
      [
        `${links.length === 1 ? 'Package' : 'Packages'}: ${links.join(', ')}.`,
        '',
        withoutComments(provider.markdown)
      ].join('\n')
    );
  }

  const truth = providerAsymmetry(providerSource, root, referenceHref);
  add(
    pagePaths.providersIndex,
    'Provider setup',
    'Which source values each provider accepts, which it refuses, and what its own options are.',
    [
      'Which source values each provider accepts, which it refuses, and what its own options are. Native files and HLS share a page, because the setup document covers them in one passage and one extension table.',
      '',
      ...providers.flatMap((provider) => [
        `## [${provider.title}](${relativePage(pagePaths.providersIndex, pagePaths.provider(provider.slug))})`,
        '',
        ...adapters(
          provider.packages,
          pagePaths.providersIndex,
          provider.title
        ).map((pkg) => `- \`${pkg.name}\` ${pkg.description}`),
        ''
      ]),
      '## What each provider can answer',
      '',
      `Every cell below is read out of \`${PROVIDER_SETUP_DOC}\`. Five providers in four columns — native files and HLS share one, because that document covers them in one passage. They do not answer the same question equally well, so the table does not pretend that they do: where a fact cannot be known, the cell says so and carries the document's own reason for it.`,
      '',
      `| | ${truth.providers
        .map(
          (provider) =>
            `[${provider.title}](${relativePage(pagePaths.providersIndex, pagePaths.provider(provider.slug))}) ${provider.packages.map((dir) => `\`${scope}${dir}\``).join(' ')}`
        )
        .map(cell)
        .join(' | ')} |`,
      `| --- | ${truth.providers.map(() => '---').join(' | ')} |`,
      ...truth.questions.map(
        (question, row) =>
          `| ${cell(question)} | ${truth.providers
            .map((provider) => {
              const reading = provider.readings[row];
              if (reading === undefined) {
                throw new Error(
                  `providerAsymmetry gave ${provider.title} no reading for "${question}".`
                );
              }
              const items = reading.items.map((item) => `\`${item}\``);
              return cell(
                [
                  `**${reading.state}**${items.length > 0 ? ` (${items.length}): ${items.join(', ')}` : ''}`,
                  reading.reason ?? ''
                ]
                  .filter((part) => part !== '')
                  .join('. ')
              );
            })
            .join(' | ')} |`
      )
    ].join('\n')
  );

  // ---- start -----------------------------------------------------------

  const entryPoint = byDir.get('react');
  if (entryPoint === undefined || entryPoint.name !== '@playdeck/react') {
    throw new Error(
      'The start page tells a reader to install @playdeck/react, which is not a publishable package at packages/react.'
    );
  }
  const peers = Object.entries(entryPoint.manifest.peerDependencies ?? {});
  if (peers.length === 0) {
    throw new Error(
      '@playdeck/react declares no peer dependencies, so the start page has nothing to tell a reader to install alongside it.'
    );
  }
  if (entryPoint.manifest.exports?.['./theme.css'] === undefined) {
    throw new Error(
      '@playdeck/react no longer exports ./theme.css, so the import the start page prints would not resolve.'
    );
  }
  /** @param {string} to */
  const fromStart = (to) => relativePage(pagePaths.start, to);
  const adapterRows = providers.flatMap((provider) =>
    adapters(provider.packages, pagePaths.start, provider.title).map((pkg) => {
      const external = Object.entries(pkg.manifest.dependencies ?? {})
        .filter(([, range]) => !String(range).startsWith('workspace:'))
        .map(([name]) => `\`${name}\``);
      return `| [${provider.title}](${fromStart(pagePaths.provider(provider.slug))}) | ${pkg.link} | ${external.length === 0 ? '—' : external.join(', ')} |`;
    })
  );

  add(
    pagePaths.start,
    'Start',
    'Install one package, paste one composition, point it at a URL.',
    [
      'Install one package, paste one composition, point it at a URL. Every block below is a file this repository compiles, printed as it is on disk.',
      '',
      '## Install',
      '',
      '```sh',
      `pnpm add ${entryPoint.name}`,
      '```',
      '',
      `Peers you supply: ${peers.map(([name, range]) => `\`${name} ${range}\``).join(', ')}. Nothing else — the provider adapters are this package's own dependencies.`,
      '',
      '## The smallest player that works',
      '',
      'A root, a viewport, the media element, and the controls a player needs to be usable. Paste it, change the URL, and there is a player on the page.',
      '',
      exampleFence('examples/quickstart.tsx'),
      '',
      '## Everything the primitives give you',
      '',
      `The same shape with the rest of it: captions, a poster, and every control the package ships. Nothing here is styled — the primitives render no CSS of their own, and what each part puts in the DOM for you to style is in [the contract guide](${fromStart(pagePaths.guide('contract'))}). For a player that looks like something without writing any, add the optional default theme, \`import '${entryPoint.name}/theme.css';\`, which [the package reference](${fromStart(pagePaths.reference(entryPoint.dir))}) covers.`,
      '',
      exampleFence('examples/react-composition.tsx'),
      '',
      `Controls draw themselves only where the provider behind them reports it can honour the command, so this composition is a different set of buttons against a YouTube video than against an MP4. Which capabilities each adapter reports is in [the capability matrix](${fromStart(pagePaths.guide('capabilities-matrix'))}).`,
      '',
      '## Every provider, one prop',
      '',
      'The `source` value is what chooses an adapter, and it is the only thing that changes between them. An adapter is imported dynamically, so the one your source selects is the only one a reader of your site downloads — together with whatever that adapter brings with it, which for HLS is almost all of the cost.',
      '',
      '| Provider | Adapter | Brings with it |',
      '| --- | --- | --- |',
      ...adapterRows,
      '',
      'A dependency is downloaded only when the adapter that imports it is, and hls.js not even then where the browser plays HLS itself — Safari and iOS never fetch it. YouTube and Wistia bring nothing because they load their player from their own origin at run time, which is a request rather than a package in your bundle. A provider name above links to the source values it accepts; the adapter beside it links to what that package reports about itself.',
      '',
      '## Where to go next',
      '',
      `- [Guides](${fromStart(pagePaths.guidesIndex)}) — What a part is, what it puts in the DOM, and how to style one.`,
      `- [Reference](${fromStart(pagePaths.referenceIndex)}) — Every published package, rendered from the README in its own tarball.`,
      `- [Provider setup](${fromStart(pagePaths.providersIndex)}) — Which source values each provider accepts, and which it refuses.`,
      `- [Examples](${fromStart(pagePaths.examples)}) — Two finished players, running, printed beside the files they are.`
    ].join('\n')
  );

  // ---- examples --------------------------------------------------------

  add(
    pagePaths.examples,
    'Examples',
    'Two composed players, built from the same primitives for two different jobs.',
    [
      'Two composed players, built from the same primitives for two different jobs. Each is named for its job and not for a company that does it, and each is printed below exactly as it is on disk.',
      '',
      'Both players are dormant until you press them. `loading="interaction"` holds the root closed, so no clip is fetched and no provider is attached before that press — this page makes no third-party request until you ask it to. Every control you then see is one the player reported it can honour; the ones it cannot are absent rather than present and disabled.',
      '',
      '## A streaming service',
      '',
      'Long-form viewing. The picture owns the frame, the chrome sits on top of it, chapters are marks on the scrubber, and the one thing a viewer chooses — quality — is folded into a settings menu. That menu is absent here, and that is the point: the native provider cannot switch renditions of a progressive file, so `selectQuality` reads `unavailable` and nothing draws a ladder the provider never published. The caption toggle prints the renderer that actually honoured it beside itself.',
      '',
      '<!-- demo:streaming-service -->',
      '',
      exampleFence('examples/archetype-streaming-service.tsx'),
      '',
      '## A course platform',
      '',
      'Study rather than viewing, and deliberately not the layout above with different colours. The video shares the page with the lesson instead of owning it; the transport is docked under the picture rather than laid over it, so nothing ever covers what is being read; playback speed is a visible row rather than a menu entry, because somebody working through a recording changes it constantly; and navigation is an outline of real buttons rather than ticks on a bar.',
      '',
      '<!-- demo:course-platform -->',
      '',
      exampleFence('examples/archetype-course-platform.tsx'),
      '',
      '## Media and licence',
      '',
      "Both clips are Blender Foundation open-movie trailers, played from the foundation's own download host: *Sintel* above and *Big Buck Bunny* below it. Both are © Blender Foundation and licensed [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/), which is the attribution this line exists to give.",
      '',
      'Chapter marks, outline titles and caption text are fixtures the examples ship. They mark time in each clip and describe neither film — a demo that implied it had read metadata it invented would be the one dishonest thing on a page about honesty.'
    ].join('\n')
  );

  files.set('nav.json', `${JSON.stringify(nav, null, 2)}\n`);
  return files;
};

/**
 * Every file under the package directory this writes or would remove: the
 * generated ones on disk, everything but `KEPT` and `node_modules`.
 * @param {string} dir
 * @param {string} [current]
 * @returns {string[]}
 */
const generatedOnDisk = (dir, current = dir) =>
  readdirSync(current, { withFileTypes: true }).flatMap((dirent) => {
    const absolute = join(current, dirent.name);
    if (dirent.isDirectory()) {
      return dirent.name === 'node_modules'
        ? []
        : generatedOnDisk(dir, absolute);
    }
    const path = relative(dir, absolute).split(sep).join(posix.sep);
    return KEPT.has(path) ? [] : [path];
  });

/**
 * How the committed package differs from what `docsPackage` writes: each file
 * that is stale, missing, or no longer generated.
 * @param {string} root
 * @returns {string[]}
 */
export const docsPackageDrift = (root) => {
  const dir = join(root, DOCS_DIR);
  const expected = docsPackage(root);
  const onDisk = new Set(generatedOnDisk(dir));
  /** @type {string[]} */
  const drift = [];
  for (const [path, text] of expected) {
    if (!onDisk.has(path)) drift.push(`${DOCS_DIR}/${path} is missing`);
    else if (readFileSync(join(dir, path), 'utf8') !== text) {
      drift.push(`${DOCS_DIR}/${path} is out of date`);
    }
  }
  for (const path of onDisk) {
    if (!expected.has(path)) {
      drift.push(`${DOCS_DIR}/${path} is not generated any more`);
    }
  }
  return drift;
};

const main = () => {
  const dir = join(repoRoot, DOCS_DIR);
  if (process.argv.includes('--check')) {
    const drift = docsPackageDrift(repoRoot);
    if (drift.length > 0) {
      throw new Error(
        `The docs package is not what its sources generate — run \`pnpm docs:package\`:\n${drift.map((line) => `  ${line}`).join('\n')}`
      );
    }
    return;
  }
  const files = docsPackage(repoRoot);
  for (const path of generatedOnDisk(dir)) {
    if (!files.has(path)) rmSync(join(dir, path));
  }
  for (const [path, text] of files) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  console.log(`Wrote ${files.size} files to ${DOCS_DIR}.`);
};

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
