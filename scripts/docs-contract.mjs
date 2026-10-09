// The docs contract deck.cool's site holds `@playdeck/docs` to, checked here
// so a release cannot publish a package that site's build refuses.
//
// The rules are the ones in deck.cool's `docs/docs-contract.md`, and the code
// follows its loader -- `scanPage`, `readNav` and `routeCollisions` in
// `packages/docs/src/{page,loader}.ts` of pedrosousa13/deck-cool -- on the same
// `marked` version, so a token this reads as HTML is one that loader reads as
// HTML too. It is a port rather than an import because that loader is a
// private workspace package of another repository. What it leaves out is what
// only the site can know: the code-fence languages the site loads, and the
// rewriting of links into routes, which checks nothing.
//
// When deck.cool's loader changes a rule, change it here as well.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';
import { Marked, Tokenizer } from 'marked';
import { parse as parseYaml } from 'yaml';

/** @typedef {{ file: string; line: number; message: string }} Fault */

const MARKER = /^<!-- demo:([A-Za-z0-9_-]+) -->$/;
const MARKER_START = /<!--\s*demo:/;
const NOT_RELATIVE = /^(?:[a-z][a-z0-9+.-]*:|\/|#|$)/i;
const SCHEME = /^([a-z][a-z0-9+.-]*):/i;
const ALLOWED_SCHEMES = new Set(['http', 'https', 'mailto']);
const NAV = 'nav.json';
const EXTENSION = '.md';
/** npm puts these in every package, so they are not pages. */
const NOT_PAGES = new Set(['readme.md', 'changelog.md', 'license.md']);
const SKIPPED_DIRECTORIES = new Set(['assets', 'node_modules']);

/**
 * The frontmatter and the body after it, as `@pagedeck/markdown-loader`'s
 * `parseFrontmatter` splits them: a `---` line, YAML, a `---` line.
 * @param {string} source
 * @returns {{ frontmatter: Record<string, unknown>; body: string }}
 */
const splitFrontmatter = (source) => {
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(source);
  if (match === null) return { frontmatter: {}, body: source };
  const data = parseYaml(match[1] ?? '');
  return {
    frontmatter: typeof data === 'object' && data !== null ? data : {},
    body: source.slice(match[0].length)
  };
};

/**
 * @param {import('marked').Token} token
 * @returns {{ kind: 'html'; raw: string; block: boolean } | { kind: 'link' | 'image' | 'def'; raw: string; href: string } | undefined}
 */
const found = (token) => {
  if (token.type === 'html') {
    return { kind: 'html', raw: token.raw, block: token.block === true };
  }
  if (token.type !== 'link' && token.type !== 'image' && token.type !== 'def') {
    return undefined;
  }
  if (typeof token.href !== 'string') return undefined;
  return { kind: token.type, raw: token.raw, href: token.href };
};

/**
 * Where `raw` is in the body, from `from` on, allowing for the `>` and indent
 * marked strips from a token inside a block quote or a list.
 * @param {string} body
 * @param {string} raw
 * @param {number} from
 */
const locate = (body, raw, from) => {
  const pattern = raw
    .trimEnd()
    .split('\n')
    .map((line) => line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\n[ \\t>]*');
  const search = new RegExp(pattern, 'g');
  search.lastIndex = from;
  const match = search.exec(body);
  return match === null ? undefined : { at: match.index, text: match[0] };
};

/**
 * One page's faults.
 * @param {string} file
 * @param {string} text
 * @param {{ pages: ReadonlySet<string>; exists: (file: string) => boolean; demos: ReadonlySet<string> }} context
 * @returns {Fault[]}
 */
export const pageFaults = (file, text, context) => {
  const source = text.replace(/\r\n?/g, '\n');
  const { frontmatter, body } = splitFrontmatter(source);
  /** @type {Fault[]} */
  const faults = [];
  const firstLine = source.split('\n').length - body.split('\n').length + 1;
  /** @param {number} offset */
  const lineAt = (offset) =>
    firstLine + (body.slice(0, offset).match(/\n/g)?.length ?? 0);
  /** @param {number} offset @param {string} message */
  const fault = (offset, message) =>
    faults.push({ file, line: lineAt(offset), message });

  for (const field of /** @type {const} */ (['title', 'description'])) {
    const value = frontmatter[field];
    if (typeof value !== 'string' || value.trim() === '') {
      faults.push({
        file,
        line: 1,
        message: `has no "${field}" in its frontmatter`
      });
    }
  }

  /** @type {import('marked').Tokens.Def[]} */
  const definitions = [];
  const marked = new Marked({
    tokenizer: {
      /** @this {Tokenizer} @param {string} src */
      def(src) {
        const definition = Tokenizer.prototype.def.call(this, src);
        if (definition) definitions.push(definition);
        return false;
      }
    }
  });

  let offset = 0;
  for (const block of marked.lexer(body)) {
    let cursor = offset;
    marked.walkTokens([block], (walked) => {
      const token = found(walked);
      if (token === undefined) return;
      const located = locate(body, token.raw, cursor);
      if (located === undefined) {
        fault(
          offset,
          `has HTML, a link or an image the loader cannot find in the file, ${token.raw.trim().split('\n')[0] ?? ''}`
        );
        return;
      }
      const { at, text: matched } = located;
      cursor =
        token.kind === 'link' || token.kind === 'image'
          ? at + 1
          : at + matched.length;

      if (token.kind === 'html') {
        if (!MARKER_START.test(token.raw)) {
          fault(
            at,
            `has raw HTML, ${token.raw.trim().split('\n')[0] ?? ''} — the only HTML a page may hold is a demo marker`
          );
          return;
        }
        const name = MARKER.exec(token.raw.trim())?.[1];
        if (!token.block || name === undefined) {
          fault(at, 'has a demo marker that is not on a line of its own');
        } else if (!context.demos.has(name)) {
          fault(
            at,
            `marks demo "${name}", which the site does not register (${[...context.demos].sort().join(', ')})`
          );
        }
        return;
      }

      if (
        token.kind === 'link' &&
        token.raw.startsWith('[') &&
        !token.raw.includes('](')
      ) {
        return;
      }
      if (token.href.includes('&')) {
        fault(
          at,
          `links to "${token.href}", which holds a character reference — write it with no "&"`
        );
        return;
      }
      if (/^[/\\]{2}/.test(token.href)) {
        fault(at, `links to "${token.href}", which names no scheme`);
        return;
      }
      const scheme = SCHEME.exec(token.href)?.[1];
      if (scheme !== undefined && !ALLOWED_SCHEMES.has(scheme.toLowerCase())) {
        fault(at, `links to "${token.href}", a scheme the site does not allow`);
        return;
      }
      if (NOT_RELATIVE.test(token.href)) return;
      const hash = token.href.indexOf('#');
      const path = hash === -1 ? token.href : token.href.slice(0, hash);
      const target = posix.join(posix.dirname(file), path);

      if (token.kind === 'image') {
        if (!target.startsWith('assets/') || !context.exists(target)) {
          fault(at, `shows "${token.href}", which is not a file under assets/`);
        }
        return;
      }
      if (!target.endsWith(EXTENSION)) {
        fault(at, `links to "${token.href}", which is not a .md page`);
      } else if (!context.pages.has(target)) {
        fault(
          at,
          `links to "${token.href}", which is not a page in this package`
        );
      } else if (
        matched.indexOf(
          token.href,
          matched.indexOf(token.kind === 'def' ? ']:' : '](')
        ) === -1
      ) {
        fault(
          at,
          `links to "${token.href}" in a form the loader cannot rewrite`
        );
      }
    });
    offset += block.raw.length;
  }

  /** @type {Set<string>} */
  const labels = new Set();
  let definitionCursor = 0;
  for (const definition of definitions) {
    const located = locate(body, definition.raw, definitionCursor);
    if (located !== undefined) {
      definitionCursor = located.at + located.text.length;
    }
    if (labels.has(definition.tag)) {
      fault(
        located?.at ?? 0,
        `defines [${definition.tag}] a second time — give each definition its own label`
      );
    }
    labels.add(definition.tag);
  }

  return faults;
};

/**
 * Every page's path from the package root, POSIX-spelled and sorted.
 * @param {string} root
 * @param {string} [directory]
 * @returns {string[]}
 */
export const pageFiles = (root, directory = root) => {
  /** @type {string[]} */
  const files = [];
  for (const dirent of readdirSync(directory, { withFileTypes: true })) {
    const absolute = join(directory, dirent.name);
    if (dirent.isDirectory()) {
      if (!(directory === root && SKIPPED_DIRECTORIES.has(dirent.name))) {
        files.push(...pageFiles(root, absolute));
      }
      continue;
    }
    if (!dirent.isFile() || !dirent.name.endsWith(EXTENSION)) continue;
    if (directory === root && NOT_PAGES.has(dirent.name.toLowerCase())) {
      continue;
    }
    files.push(relative(root, absolute).split(sep).join(posix.sep));
  }
  return files.sort();
};

/**
 * The route a page is served at, under a site base of `/` and Pagedeck's
 * default trailing slash.
 * @param {string} file
 */
const routeOf = (file) => {
  const parts = file.slice(0, -EXTENSION.length).split('/');
  if (parts.at(-1) === 'index') parts.pop();
  return parts.length === 0 ? '/' : `/${parts.join('/')}/`;
};

/** @param {string} path */
const isFile = (path) => existsSync(path) && statSync(path).isFile();

/**
 * @param {string} root
 * @param {ReadonlySet<string>} pages
 * @returns {Fault[]}
 */
const navFaults = (root, pages) => {
  const path = join(root, NAV);
  if (!isFile(path)) {
    return [{ file: NAV, line: 1, message: 'is missing' }];
  }
  const text = readFileSync(path, 'utf8');
  /** @type {unknown} */
  let groups;
  try {
    groups = JSON.parse(text);
  } catch {
    groups = undefined;
  }
  if (
    !Array.isArray(groups) ||
    !groups.every(
      (group) =>
        typeof group === 'object' &&
        group !== null &&
        typeof group.label === 'string' &&
        Array.isArray(group.pages) &&
        group.pages.every(
          (/** @type {unknown} */ page) => typeof page === 'string'
        )
    )
  ) {
    return [{ file: NAV, line: 1, message: 'is not a list of groups' }];
  }
  /** @type {Fault[]} */
  const faults = [];
  /** @type {Set<string>} */
  const listed = new Set();
  let cursor = 0;
  for (const page of groups.flatMap(
    (group) => /** @type {string[]} */ (group.pages)
  )) {
    const at = text.indexOf(JSON.stringify(page), cursor);
    cursor = at === -1 ? cursor : at + 1;
    const line = text.slice(0, Math.max(at, 0)).split('\n').length;
    if (listed.has(page)) {
      faults.push({
        file: NAV,
        line,
        message: `lists "${page}" a second time`
      });
    } else if (!pages.has(page)) {
      faults.push({
        file: NAV,
        line,
        message: `lists "${page}", which is not a page`
      });
    }
    listed.add(page);
  }
  for (const page of pages) {
    if (!listed.has(page)) {
      faults.push({ file: page, line: 1, message: `is not listed in ${NAV}` });
    }
  }
  return faults;
};

/**
 * Every fault in the docs package at `root`, by file and then by line.
 * @param {string} root
 * @param {{ demos: ReadonlySet<string> }} options
 * @returns {Fault[]}
 */
export const contractFaults = (root, { demos }) => {
  const files = pageFiles(root);
  const pages = new Set(files);
  const context = {
    pages,
    exists: (/** @type {string} */ file) => isFile(join(root, file)),
    demos
  };
  /** @type {Map<string, string>} */
  const owners = new Map();
  /** @type {Fault[]} */
  const collisions = [];
  for (const file of files) {
    const route = routeOf(file);
    const owner = owners.get(route);
    if (owner === undefined) owners.set(route, file);
    else {
      collisions.push({
        file,
        line: 1,
        message: `has the route ${route}, as ${owner} does`
      });
    }
  }
  return [
    ...navFaults(root, pages),
    ...collisions,
    ...files.flatMap((file) =>
      pageFaults(file, readFileSync(join(root, file), 'utf8'), context)
    )
  ].sort((a, b) =>
    a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line
  );
};
