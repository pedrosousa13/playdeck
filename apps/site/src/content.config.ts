/*
 * The reference collection: the package READMEs themselves, loaded from
 * `packages/` and not copied into this app.
 *
 * That is the whole point of the ticket (#523). Those files ship inside every
 * npm tarball, their code fences are generated from real sources in `examples/`
 * by `scripts/docs-examples.mjs`, and `pnpm docs:check` compares them byte for
 * byte on every run. A site-native retelling would be a second copy that no gate
 * watches, which is the drift this repository spent v1 removing. Editing a
 * README is therefore the only way to change a reference page, and there is
 * nothing here for an edit to forget to update.
 *
 * The loader below reads those files itself rather than reaching for the content
 * layer's `glob()`, and the reason is the link rewriting further down: `glob()`
 * hands each file to the Markdown entry type and offers nothing in between, so
 * there is no point at which the text can be transformed before it is parsed.
 * `renderMarkdown()` from the loader context is the same processor `glob()`
 * would have reached — it is built from `markdown` in `astro.config.ts`, Shiki
 * configuration included — so the documents are highlighted and sliced into
 * headings exactly as they were, and `render()` still gives a page back both the
 * compiled Markdown and the heading list its table of contents is built from.
 * That is why the navigation is derived from the same parse that produced the
 * document rather than from a parallel list somebody has to maintain.
 *
 * Everything this file says about the content layer -- what `glob()` hands on,
 * what `renderMarkdown()` is built from, and the `watcher` the loader context
 * supplies in dev and not in a build -- was read off `astro` 7.2.9, which is the
 * exact version `apps/site/package.json` pins rather than a range. These are
 * claims about one release's loader API and not guarantees it makes across
 * versions, so the upgrade that moves that pin is the moment to re-read them.
 *
 * Every `packages/*` README is loaded, publishable or not. Which of them get a
 * page is a separate question with a definition of its own -- a manifest that
 * does not set `private`, per `scripts/workspace-packages.mjs` -- and
 * `src/pages/reference/[pkg].astro` asks it there rather than encoding an answer
 * in this file's directory scan. What does turn on the answer is the link
 * rewriting: it resolves a README's relative targets against that package's own
 * `repository` field, so it runs only for a package that has a page, and only
 * that package is required to carry the field. A private package is loaded with
 * its text untouched, which is all a document nothing renders needs.
 *
 * No schema. A schema validates frontmatter, and these files have none: they are
 * documents for npm first, and requiring frontmatter of them would be this site
 * asking the packages to carry something for its own benefit.
 */

import { defineCollection } from 'astro:content';
import { existsSync, readFileSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { referencePackageDirs } from './reference-packages.mjs';
import { PROVIDER_SETUP_DOC, providerDocuments } from './provider-pages.mjs';
import { GUIDES, guideDocument } from './guide-pages.mjs';

const repoRoot = import.meta.env.PLAYDECK_REPO_ROOT;
const packagesDir = join(repoRoot, 'packages');

/*
 * The branch a link into the repository resolves against. It cannot be derived
 * from a manifest -- a `repository` field carries a clone URL and a directory
 * and never a ref -- and the branch this repository publishes from is `main`,
 * the same one every `homepage` and every hand-written link in the READMEs
 * already names.
 *
 * `scripts/verify-packaging.mjs` holds the second copy of this, as the whole
 * literal `https://github.com/pedrosousa13/playdeck/blob/main/` at its
 * `repositoryBlobUrl`, and the two have to agree: that gate only checks the
 * links that already start with its own url, so a branch changed here and not
 * there would leave the site rewriting into `blob/<new>` while every one of
 * those targets silently stopped being checked at all. They are not extracted
 * into one module because they are not one value -- this builds a url per
 * package out of that package's own `repository` field, that one is a single
 * literal for this repository -- so a shared export would have to be
 * decomposed on one side or recomposed on the other to be used.
 */
const branch = 'main';

/**
 * Where a file inside a package lives on GitHub, derived from that package's own
 * `repository` field rather than written out. Every publishable manifest carries
 * one and npm reads it, but nothing in the packaging gates would catch a missing
 * one on this file's behalf: `scripts/verify-packaging.mjs` never reads the
 * field, and its link checking begins at a hardcoded blob url, so a package
 * whose manifest lost its `repository` would simply have no link of that shape
 * to check. The throw below is therefore the only thing that reports it, which
 * is why it is a throw and not a fallback.
 *
 * @param {string} dir
 * @returns {string}
 */
const blobUrl = (dir) => {
  const manifest = JSON.parse(
    readFileSync(join(packagesDir, dir, 'package.json'), 'utf8')
  );
  const slug = /github\.com\/(.+?)(?:\.git)?$/.exec(
    manifest.repository?.url ?? ''
  )?.[1];
  if (slug === undefined) {
    throw new Error(
      `packages/${dir}/package.json has no GitHub repository URL to resolve its README's relative links against. Add a "repository" field, as every other package here has.`
    );
  }
  return `https://github.com/${slug}/blob/${branch}/`;
};

/**
 * One link target, as the site needs it rather than as npm needs it.
 *
 * A README is one document read in two places, and two kinds of link in it are
 * correct in the tarball and wrong here:
 *
 * A link to a page of this very site, which a README has to write as an
 * absolute `https://playdeck.video/…` url because that is the only address that
 * works from inside a tarball. Followed as written it would take a reader of
 * `/reference/react/` out to production and back in — which is merely wasteful
 * at the apex and wrong everywhere else: from a build made with
 * `--base /playdeck/`, or from a preview, it leaves the build the reader is
 * actually in. So the origin is stripped and the path re-addressed through
 * `import.meta.env.BASE_URL`, which is the same treatment every hand-written
 * link on this site gets (#435). The origin is `site` from `astro.config.ts`
 * rather than a literal here, so there is no second place for it to be wrong.
 *
 * A target relative to the package directory resolves beside the README on npm
 * and on GitHub, where the file it names really does sit. On this site it would
 * resolve under
 * `/reference/<package>/`, where nothing sits: the site publishes the README and
 * not the package. So it is pointed at the file's real home on GitHub, which is
 * where a reader of the site was always going to have to end up.
 *
 * A link to another package's README, which the READMEs write as a GitHub blob
 * URL because that is the only address that works from inside a tarball,
 * resolves to raw Markdown on GitHub -- sending a reader out of the site to read
 * a document the page they are on is rendering a sibling of. Those become links
 * to that package's own reference page, fragment kept, so a cross-reference
 * lands on the heading it named. Only for a package that has a page: the set
 * comes from `referencePackageDirs`, and a link to one that has none is left
 * alone rather than pointed at a route that would 404.
 *
 * Everything else is left exactly as written -- external links, in-page
 * fragments, and links to files on GitHub that are not another package's README.
 *
 * @param {string} target
 * @param {{ dir: string; pages: ReadonlySet<string>; blob: string; site: string }} context
 * @returns {string}
 */
const rewriteTarget = (target, { dir, pages, blob, site }) => {
  if (target.startsWith(site)) {
    return `${import.meta.env.BASE_URL}${target.slice(site.length)}`;
  }
  if (target.startsWith(blob)) {
    const crossPackage = /^packages\/([^/]+)\/README\.md(#.+)?$/.exec(
      target.slice(blob.length)
    );
    if (crossPackage === null || !pages.has(crossPackage[1]!)) {
      return target;
    }
    // Through `import.meta.env.BASE_URL`, which is what Astro fills the
    // configured `base` into, and never as a literal `/reference/`. The prefix
    // is the root today and the literal would be identical, which is exactly why
    // the habit is kept: the pages in `src/pages/reference/` are written the same
    // way for the same reason.
    return `${import.meta.env.BASE_URL}reference/${crossPackage[1]}/${crossPackage[2] ?? ''}`;
  }
  const relativeToPackage =
    !/^[a-z][a-z0-9+.-]*:/i.test(target) &&
    !target.startsWith('/') &&
    !target.startsWith('#');
  return relativeToPackage ? `${blob}packages/${dir}/${target}` : target;
};

/**
 * The same document with those two classes of target redirected, and nothing
 * else touched. A transform of the source and not a second copy of it: a README
 * edit still changes the page, and there is no forked text to fall out of date.
 *
 * Fenced blocks are stepped over rather than scanned. That is a requirement and
 * not a tidiness: those fences are generated from `examples/` and `pnpm
 * docs:check` compares them byte for byte, so an example containing Markdown
 * link syntax must come out of this function unchanged rather than come out
 * rewritten and put the site and the gate into disagreement about what the
 * example is.
 *
 * What it handles, stated plainly, because the person who needs this is somebody
 * adding a link to a README and wondering whether the site will re-address it.
 * Rewritten: an inline link written `[text](target)` whose target has no spaces
 * and no parentheses, on a line outside a ``` or `~~~` fence. Deliberately left
 * alone, every one of them safe to leave because leaving a link as the README
 * wrote it is this function's own fallback: an image, `![alt](target)`, which
 * points at a file the site does not publish and for which a rewrite is never
 * the right answer; a title, `[text](target "title")`; an angle-bracketed
 * target, `[text](<target>)`; a target containing parentheses; and a
 * reference-style definition, `[label]: target`. A link in one of those forms
 * simply ships as written, which on the site means a relative target that
 * 404s -- so write cross-package links and `LICENSE`-style targets as plain
 * inline links and they will be re-addressed.
 *
 * Two things it reads more widely than Markdown does, both harmless on the
 * current corpus and neither worth a parser: a code block indented by four
 * spaces is prose to the fence tracking above, and the tracking is one shared
 * flag for both fence characters, so an unclosed fence would invert the rest of
 * a file. `pnpm docs:check` is what would notice either, by failing on a fence
 * that no longer matches its source.
 *
 * @param {string} markdown
 * @param {{ dir: string; pages: ReadonlySet<string>; blob: string; site: string }} context
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

const reference = defineCollection({
  loader: {
    name: 'package-readmes',
    load: async ({
      store,
      config,
      renderMarkdown,
      generateDigest,
      logger,
      watcher
    }) => {
      const pages = new Set(referencePackageDirs(repoRoot));
      const root = fileURLToPath(config.root);
      // The origin this site is published at, as a prefix a link can be tested
      // against. `astro.config.ts` sets `site` and Astro's own canonical urls
      // are built from it, so a README naming a different origin is naming a
      // different site and is left alone. Named as a failure rather than
      // defaulted, because the fallback would be silent: every README link to
      // this site would keep pointing at production from every build.
      if (config.site === undefined) {
        throw new Error(
          'astro.config.ts sets no `site`, so a README link to a page of this site cannot be told from a link off it. Restore `site` there, or drop the rewriting in src/content.config.ts.'
        );
      }
      const site = `${new URL(config.site).origin}/`;

      /**
       * One package's README, stored under its directory name. That name is what
       * the route is spelt with and what the publishable check matches against;
       * a slug of the path would carry `readme` into the URL, where it says
       * nothing to a reader.
       *
       * `body` is the file as it is on disk, unrewritten, because that is what
       * `entry.body` means: the rewriting is how the document is addressed from
       * this site, not what the document is.
       *
       * @param {string} dir
       */
      const sync = async (dir) => {
        const file = join(packagesDir, dir, 'README.md');
        // A package without a README is skipped here and not reported here. If
        // it is publishable, `src/reference-packages.mjs` throws by name and
        // says what to do about it; if it is private, it was never going to have
        // a page and its absence is not a problem this file has an opinion on.
        if (!existsSync(file)) {
          return;
        }
        const source = await readFile(file, 'utf8');
        // Rewriting is for the packages that get a page, and so is the demand
        // that a manifest carry a `repository` field: `blobUrl` throws without
        // one, and a private package has no page for that throw to be protecting
        // -- failing the whole site build over a document nobody can navigate to
        // would be the loader deciding publishability after all. For a package
        // that does have a page the throw stands, because a reference page whose
        // relative links resolve nowhere is a real misconfiguration.
        const blob = pages.has(dir) ? blobUrl(dir) : undefined;
        store.set({
          id: dir,
          data: {},
          body: source,
          filePath: relative(root, file),
          digest: generateDigest(source),
          rendered: await renderMarkdown(
            blob === undefined
              ? source
              : rewriteLinks(source, { dir, pages, blob, site }),
            { fileURL: pathToFileURL(file) }
          )
        });
      };

      store.clear();
      const contents = await readdir(packagesDir, { withFileTypes: true });
      await Promise.all(
        contents
          .filter((entry) => entry.isDirectory())
          .map((entry) => sync(entry.name))
      );

      // Dev only: `watcher` is absent in a build. Without this, `packages/` is
      // outside everything the dev server watches, and editing a README would
      // leave the open page showing the previous text until the server was
      // restarted -- which is the same stale-copy failure this collection exists
      // to prevent, arriving by another route.
      if (watcher === undefined) {
        return;
      }
      watcher.add(packagesDir);
      /** @param {string} changed */
      const reload = async (changed) => {
        const [dir, ...rest] = relative(packagesDir, changed).split(sep);
        if (dir === undefined || rest.join('/') !== 'README.md') {
          return;
        }
        await sync(dir);
        logger.info(`Reloaded packages/${dir}/README.md`);
      };
      watcher.on('add', reload);
      watcher.on('change', reload);
    }
  }
});

/*
 * The provider setup pages, cut out of `docs/provider-setup.md`.
 *
 * A second collection rather than a second entry in the one above, because the
 * two are loaded from different places under different rules and share only the
 * principle: the site renders a document this repository already keeps true and
 * writes none of its own. Which sections reach which page, why the pages are
 * selections rather than summaries, and what the one dropped sentence is are
 * all in `src/provider-pages.mjs`, beside the code that decides them.
 *
 * The link rewriting happens there too, before `renderMarkdown` sees the text,
 * for the reason this file's own rewriting does: the content layer's `glob()`
 * hands a file straight to the Markdown entry type and offers no point in
 * between at which the text can be transformed.
 *
 * `data` carries what the route needs and the body does not say: the page's
 * title, which is the provider's name lifted out of the heading or the bold
 * lead that was dropped, the packages the adapter ships in, and the position
 * the document introduces it at. Still no schema, for the reason the collection
 * above has none — nothing here is frontmatter, and a schema would validate a
 * shape this file has just built rather than one it read.
 */
const providers = defineCollection({
  loader: {
    name: 'provider-setup',
    load: async ({
      store,
      config,
      renderMarkdown,
      generateDigest,
      logger,
      watcher
    }) => {
      const file = join(repoRoot, PROVIDER_SETUP_DOC);
      // Relative to the Astro project rather than to the repository, which is
      // what `filePath` means and what the collection above stores; the four
      // entries share it, because they are four selections of one file.
      const filePath = relative(fileURLToPath(config.root), file);

      const sync = async () => {
        const source = await readFile(file, 'utf8');
        const documents = providerDocuments(source, repoRoot);
        store.clear();
        await Promise.all(
          documents.map(async (document, order) => {
            store.set({
              id: document.slug,
              data: {
                title: document.title,
                packages: document.packages,
                order
              },
              // The composed document rather than the file, because that is
              // what this entry is: `entry.body` on a page holding a selection
              // of a document should be the selection. The file itself is one
              // `git show` away and is what `docs/provider-setup.md` renders as
              // on GitHub.
              body: document.markdown,
              filePath,
              digest: generateDigest(document.markdown),
              rendered: await renderMarkdown(document.markdown, {
                fileURL: pathToFileURL(file)
              })
            });
          })
        );
      };

      await sync();

      // Dev only: `watcher` is absent in a build. `docs/` is outside everything
      // the dev server watches, so without this an edit to the document would
      // leave every open provider page showing the previous text until the
      // server was restarted — the same stale-copy failure these pages exist to
      // prevent, arriving by another route.
      if (watcher === undefined) {
        return;
      }
      watcher.add(file);
      const reload = async (changed: string) => {
        if (
          relative(repoRoot, changed).split(sep).join('/') !==
          PROVIDER_SETUP_DOC
        ) {
          return;
        }
        await sync();
        logger.info(`Reloaded ${PROVIDER_SETUP_DOC}`);
      };
      watcher.on('add', reload);
      watcher.on('change', reload);
    }
  }
});

/*
 * The library-wide guides, loaded from the workbench's `Overview/*` MDX.
 *
 * A third collection rather than a third entry in either of the two above, for
 * the reason there are two rather than one: these are loaded from a different
 * place under different rules, and share only the principle — the site renders
 * a document this repository already keeps true and writes none of its own.
 * Which documents get a page, why the two `Overview/*` files that are absent
 * are absent, and what has to be taken off a Storybook MDX before Markdown can
 * render it are all in `src/guide-pages.mjs`, beside the code that decides
 * them.
 *
 * The stripping and the link rewriting happen there too, before
 * `renderMarkdown` sees the text, for the reason both collections above do
 * their own: the content layer's `glob()` hands a file straight to the Markdown
 * entry type and offers no point in between at which the text can be
 * transformed.
 *
 * `data` carries what the route needs and the body does not say: the page's
 * title, lifted out of the document's own `# ` heading, and the position the
 * table in that module puts it at. Still no schema, for the reason the two
 * above have none — nothing here is frontmatter.
 */
const guides = defineCollection({
  loader: {
    name: 'workbench-guides',
    load: async ({
      store,
      config,
      renderMarkdown,
      generateDigest,
      logger,
      watcher
    }) => {
      const pages = new Set(referencePackageDirs(repoRoot));
      const root = fileURLToPath(config.root);

      /**
       * One guide, stored under the slug its route is spelt with.
       *
       * `body` is the stripped document rather than the file, because that is
       * what this entry is: the `<Meta>` tag and the example markers are
       * Storybook's scaffolding around the document and not part of it. The
       * file itself is one `git show` away.
       *
       * @param {{ file: string; slug: string }} guide
       * @param {number} order
       */
      const sync = async ({ file, slug }, order) => {
        const path = join(repoRoot, file);
        const source = await readFile(path, 'utf8');
        const { title, markdown } = guideDocument(source, file, pages);
        store.set({
          id: slug,
          data: { title, order },
          body: markdown,
          // Relative to the Astro project rather than to the repository, which
          // is what `filePath` means and what the two collections above store.
          filePath: relative(root, path),
          digest: generateDigest(markdown),
          rendered: await renderMarkdown(markdown, {
            fileURL: pathToFileURL(path)
          })
        });
      };

      store.clear();
      await Promise.all(GUIDES.map((guide, order) => sync(guide, order)));

      // Dev only: `watcher` is absent in a build. `apps/storybook/` is outside
      // everything this dev server watches, so without this an edit to one of
      // those documents would leave the open guide page showing the previous
      // text until the server was restarted — the same stale-copy failure these
      // pages exist to prevent, arriving by another route.
      if (watcher === undefined) {
        return;
      }
      for (const { file } of GUIDES) {
        watcher.add(join(repoRoot, file));
      }
      const reload = async (changed: string) => {
        const path = relative(repoRoot, changed).split(sep).join('/');
        const order = GUIDES.findIndex((entry) => entry.file === path);
        if (order === -1) {
          return;
        }
        await sync(GUIDES[order], order);
        logger.info(`Reloaded ${path}`);
      };
      watcher.on('add', reload);
      watcher.on('change', reload);
    }
  }
});

export const collections = { guides, providers, reference };
