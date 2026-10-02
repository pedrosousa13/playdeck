#!/usr/bin/env node
// The rule that a pending changeset's prose is written in the present tense,
// never narrating how the code used to behave -- #870.
//
// Front matter is exempt because it never reads as prose: changesets writes
// it as a package name and a bump level, never a sentence a reader narrates
// through. `changesetProblems` strips exactly the leading `---`-delimited
// block changesets itself writes, and reads every line after it.
//
// The judgement is a pure function over text, the shape
// scripts/story-fixtures.mjs's own rule takes: `changesetProblems` answers
// with where the problem is, and reading a directory happens only in
// `pendingChangesetFiles`/`pendingChangesetProblems` and in `main`.
// `README.md` and `config.json` are never read as changesets -- the first
// documents the format, the second configures the release tool -- and both
// are excluded by the `.md`-except-`README.md` filter below.

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const console = globalThis.console;
const process = globalThis.process;
const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const CHANGESET_DIR = '.changeset';

/**
 * The phrasing this rule exists to catch, case-insensitively: a bare "now"
 * (never inside a longer word such as "known" or "snow", which `\b` excludes
 * because neither has a word boundary on both sides of its "now"),
 * "previously", "used to", and "as before". Each names a state the code is no
 * longer in rather than the one a reader installing the version gets.
 */
const NARRATES_HISTORY = /\bnow\b|previously|used to|as before/gi;

/**
 * Where, in one changeset's lines, its prose starts -- the index just past
 * the closing `---` of the front matter block, or `0` if the text does not
 * open with one. Changesets always writes the block as the file's first
 * lines (`---`, one bump line per package, `---`), so text that does not open
 * on a `---` line is read whole rather than guessed at.
 * @param {string[]} lines
 * @returns {number}
 */
const proseStart = (lines) => {
  if (lines[0]?.trim() !== '---') return 0;
  const closing = lines.findIndex(
    (line, index) => index > 0 && line.trim() === '---'
  );
  return closing === -1 ? 0 : closing + 1;
};

/**
 * Every place one changeset's prose narrates history, each with the
 * 1-indexed line it sits on -- counted against the whole file, so it points
 * at the same line an editor would -- and the word or phrase matched.
 * @param {string} text
 * @returns {{ line: number; word: string }[]}
 */
export const changesetProblems = (text) => {
  const lines = text.split('\n');
  const start = proseStart(lines);

  /** @type {{ line: number; word: string }[]} */
  const problems = [];
  for (let index = start; index < lines.length; index += 1) {
    for (const match of lines[index].matchAll(NARRATES_HISTORY)) {
      problems.push({ line: index + 1, word: match[0] });
    }
  }
  return problems;
};

/**
 * The pending changesets to check: every `.md` file directly under `dir`
 * except `README.md`, which documents the format rather than describing a
 * release. `config.json` configures the release tool and is excluded by the
 * `.md` extension alone.
 * @param {string} dir
 * @returns {string[]}
 */
export const pendingChangesetFiles = (dir) =>
  readdirSync(dir, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith('.md') &&
        entry.name !== 'README.md'
    )
    .map((entry) => entry.name)
    .sort();

/**
 * `changesetProblems`, run over every pending changeset under `dir`, each
 * problem naming the file it came from.
 * @param {string} dir
 * @returns {{ file: string; line: number; word: string }[]}
 */
export const pendingChangesetProblems = (dir) =>
  pendingChangesetFiles(dir).flatMap((file) =>
    changesetProblems(readFileSync(join(dir, file), 'utf8')).map((problem) => ({
      file,
      ...problem
    }))
  );

const main = () => {
  const dir = join(repoRoot, CHANGESET_DIR);
  const problems = pendingChangesetProblems(dir);

  if (problems.length > 0) {
    throw new Error(
      `A pending changeset narrates history instead of describing the change in force. Write it in the present tense -- never "now", "previously", "used to" or "as before":\n${problems
        .map(
          (problem) =>
            `  ${relative(repoRoot, join(dir, problem.file))}:${problem.line} — "${problem.word}"`
        )
        .join('\n')}`
    );
  }

  const count = pendingChangesetFiles(dir).length;
  console.log(
    count === 0
      ? 'No pending changesets.'
      : `Checked ${count} pending changeset${count === 1 ? '' : 's'}; none narrate history.`
  );
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
