// The markdown link check `scripts/verify-packaging.mjs` runs over every
// document a tarball carries. A module of its own so it can be tested: that
// harness runs its whole pipeline the moment it is imported.

import { existsSync } from 'node:fs';
import { join, posix } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

// The link targets a markdown source names, in the three forms these documents
// use: inline `](target)`, a reference definition (which CommonMark lets sit
// under up to three spaces of indentation, and one inside a list item is
// indented), and the `href`/`src` attributes of the raw HTML that is legal in
// markdown and that GitHub renders. Angle brackets are stripped, and a title
// after the target is left behind by stopping at the first space. Fenced code
// blocks are removed before any of that, so a link written as an example is not
// read as a link.
//
// What it does not see, stated rather than implied, because this gate is the
// only thing standing between a shipped README and an unreachable link: an
// inline target containing parentheses, and a reference definition whose target
// is written `<with spaces>`. What it over-reads: a target inside a code block
// indented by four spaces rather than fenced.
/**
 * @param {string} source
 * @returns {string[]}
 */
export const linkTargets = (source) => {
  // A fence opens on a run of three or more backticks or tildes and closes on
  // the next run of the same character, so the run itself is what pairs them.
  const prose = source
    .replace(/^ {0,3}(`{3,}|~{3,})[\s\S]*?^ {0,3}\1[^\n]*$/gm, '')
    // An inline code span: a run of backticks closed by a run of the same
    // length, inside one paragraph -- so across a line break, but never across
    // a blank line, where an unmatched backtick would otherwise pair with one
    // paragraphs away.
    .replace(/(?<!`)(`+)(?!`)(?:(?!\n[ \t]*\n)[\s\S])*?(?<!`)\1(?!`)/g, '');

  return [
    ...[...prose.matchAll(/\]\(\s*([^()\s]+)/g)],
    // `(?!\^)`: a label opening with `^` is a GFM footnote definition, whose
    // colon is followed by the note's text rather than by a destination.
    ...[...prose.matchAll(/^ {0,3}\[(?!\^)[^\]]+\]:\s*(\S+)/gm)],
    ...[...prose.matchAll(/\b(?:href|src)\s*=\s*["']?([^"'>\s]+)/gi)]
  ].map(([, target]) => target.replace(/^<|>$/g, ''));
};

// Where a link that names this repository by url has to resolve. The url is
// absolute, so the path after it is repo-relative and is checked against the
// working tree rather than against the tarball -- which is why this reaches for
// `repoRoot` in the middle of a function that is otherwise reading tarball
// entries. Nothing here touches the network: a url on any other host is not
// checked at all, and a broken one there is not something a local gate can see.
//
// `apps/site/src/content.config.ts` holds the second copy of this url, built
// there out of each package's own `repository` field and a `branch` constant,
// and the two have to agree. They are not one exported value because they are
// not one shape -- that side needs a url per package, this side needs a single
// prefix to match against -- so the agreement is kept by these two comments.
// Change the branch on either side alone and nothing fails: the site rewrites
// into a url this gate no longer recognises, and every link of that shape stops
// being checked rather than starting to fail.
const repositoryBlobUrl = 'https://github.com/pedrosousa13/playdeck/blob/main/';

// A relative link resolves against wherever its file landed, and for a consumer
// that is `node_modules` rather than this repository. One that climbs out of the
// package root, or that names a path the tarball does not carry, resolves to
// nothing there. npmjs.com is where that breakage is invisible: npm's renderer
// rewrites relative links through `repository.directory`, so the package page
// keeps working while the installed file does not, and nobody reading the page
// learns anything is wrong. Shipped documents name the repository by url
// instead, which moves the risk from a link that cannot resolve to a path that
// might not exist -- so both are checked here.
/**
 * @param {string} entry
 * @param {string} source
 * @param {readonly string[]} entries
 */
export const unreachableLinks = (entry, source, entries) => {
  const dir = entry.includes('/') ? entry.replace(/\/[^/]*$/, '') : '';
  /** @type {string[]} */
  const problems = [];

  for (const target of linkTargets(source)) {
    if (target.startsWith(repositoryBlobUrl)) {
      const path = target.slice(repositoryBlobUrl.length).replace(/#.*$/, '');
      if (!existsSync(join(repoRoot, path))) {
        problems.push(
          `${entry} links to ${target}, which is not a path in this repository`
        );
      }
      continue;
    }

    // A fragment, a scheme (`https:`, `mailto:`) and a protocol-relative url
    // are each resolved by something other than the file's own location.
    if (
      target.startsWith('#') ||
      target.startsWith('//') ||
      /^[a-z][a-z0-9+.-]*:/i.test(target)
    ) {
      continue;
    }
    const path = posix.normalize(
      posix.join(dir, target.replace(/[#?].*$/, ''))
    );
    if (path === '..' || path.startsWith('../')) {
      problems.push(`${entry} links to ${target}, which escapes the package`);
    } else if (
      !entries.includes(path) &&
      !entries.some((name) => name.startsWith(`${path}/`))
    ) {
      problems.push(`${entry} links to ${target}, which is not in the tarball`);
    }
  }

  return problems;
};
