#!/usr/bin/env node
// Every CI gate an implementer can run locally, in one command that stops at
// the first failure and names it -- #871. The two things CI runs that this
// deliberately does not: `pnpm install` (whoever runs this has already run
// it to have `node_modules` at all) and `pnpm test:e2e` (browser-bound and
// slow, and run in its own CI jobs rather than here). The `.gate/` steps the
// `audit` and `package` jobs run to pin a gate's source to `main` need no
// mention here either: they invoke `node .gate/*.mjs` directly, never
// `pnpm`, so they are simply not the kind of thing this module or the drift
// check below ever sees.
//
// `docs:bytes:check` and `compare:libraries:check` measure a gzipped byte
// count, which moves with the Node version doing the gzipping -- the byte
// checks expect Node 22, the version CI uses, so a `pnpm verify` run under a
// different Node can disagree with CI on a budget that has not actually
// moved. See AGENTS.md.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { parse } from 'yaml';

const console = globalThis.console;
const process = globalThis.process;
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

/**
 * One `pnpm` invocation found in a workflow's `run:` text, reduced to the
 * identity STEPS and EXCLUSIONS are matched against -- the flags a step
 * passes alongside it (`--project=visual`, matrix interpolations, `--check`)
 * are never what distinguishes one gate from another, so they are dropped
 * rather than carried through.
 *
 * - `{ form: 'script', script }` -- a bare `pnpm <script>` or `pnpm run
 *   <script>` (`run` names no shape of its own; it is `pnpm`'s own way of
 *   saying "run this script", so both reduce to the same identity), a root
 *   package.json script, matched on the script name alone.
 * - `{ form: 'filter', filter, script }` -- `pnpm --filter <target>
 *   <script>`, a workspace package's own script rather than a root one,
 *   matched on the target and the script together.
 * - `{ form: 'exec', command }` -- `pnpm exec <command...>`, which names no
 *   package.json script at all, matched on the whole trailing command.
 * - `{ form: 'unrecognized', statement }` -- a `pnpm` call this module
 *   cannot place into one of the three shapes above (a flag-led form such
 *   as `pnpm -r build`, or a subcommand such as `pnpm dlx <pkg>` that runs
 *   something ad hoc rather than a package.json script), matched on the
 *   whole statement. `driftProblems` reports these rather than silently
 *   dropping them or misreading a flag or subcommand as a script name.
 * @typedef {{ form: 'script', script: string } | { form: 'filter', filter: string, script: string } | { form: 'exec', command: string } | { form: 'unrecognized', statement: string }} PnpmInvocation
 */

/**
 * `statement` with any leading shell variable assignments stripped --
 * `NODE_ENV=production pnpm test` runs `pnpm test` exactly as a bare `pnpm
 * test` would, and matching only `^pnpm\b` would read no call there at all.
 * @param {string} statement
 * @returns {string}
 */
const withoutEnvPrefix = (statement) =>
  statement.replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/, '');

/**
 * `statement`, read as a `PnpmInvocation` if it names a `pnpm` call and
 * `null` otherwise -- almost every statement in a CI step is not: `git
 * fetch`, `node -e`, `rm -rf .gate`, the pinned gate runs (`node
 * .gate/audit.mjs`). Those read logic straight out of `main` rather than
 * through a package.json script (see the `audit` and `package` jobs' own
 * comments), which is exactly why nothing here has to name them: they never
 * match `^pnpm\b` and so never reach STEPS or EXCLUSIONS at all.
 *
 * A call this module cannot place into one of the three known shapes --
 * `pnpm -r build`, `pnpm dlx <pkg>`, or anything else led by a flag -- reads
 * as `{ form: 'unrecognized', statement }` rather than `null` or a guess:
 * `null` would leave the drift check silently blind to it, and reading its
 * first token as a script name would silently misname a call that may not
 * run a package.json script at all.
 * @param {string} statement
 * @returns {PnpmInvocation | null}
 */
const pnpmInvocation = (statement) => {
  const call = withoutEnvPrefix(statement).match(/^pnpm\s+(.+)$/);
  if (!call) return null;
  const rest = call[1].trim();

  const exec = rest.match(/^exec\s+(.+)$/);
  if (exec) return { form: 'exec', command: exec[1].trim() };

  const filter = rest.match(/^--filter\s+(\S+)\s+(\S+)/);
  if (filter) return { form: 'filter', filter: filter[1], script: filter[2] };

  // `run` names no shape of its own -- `pnpm run build` and `pnpm build` run
  // the same script, so both reduce to the same `script` identity.
  const run = rest.match(/^run\s+(\S+)/);
  if (run) return { form: 'script', script: run[1] };

  // `dlx` runs a package ad hoc rather than a script named in this
  // repository's own package.json, so it is read as unrecognized rather
  // than as a script literally named "dlx".
  if (/^dlx\s+/.test(rest)) {
    return { form: 'unrecognized', statement: statement.trim() };
  }

  const script = rest.match(/^(\S+)/);
  if (script && !script[1].startsWith('-')) {
    return { form: 'script', script: script[1] };
  }

  return { form: 'unrecognized', statement: statement.trim() };
};

/**
 * One `run:` step's text, split into shell statements on `&&`, `;` and line
 * breaks -- the three ways .github/workflows/ci.yml chains or lists commands
 * inside a single step. A real shell understands far more than that; this
 * reads only what that file's own steps use.
 * @param {string} run
 * @returns {string[]}
 */
const statements = (run) =>
  run
    .split(/&&|;|\n/)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);

/**
 * Every `pnpm` invocation named in a GitHub Actions workflow's `run:` steps,
 * in the order the workflow lists them. Parses the YAML and reads each
 * step's own `run:` field, rather than scanning the raw file text -- several
 * of .github/workflows/ci.yml's own job comments quote a real command for
 * rationale ("`pnpm test:audit` prints every advisory it found...") without
 * that command ever running there, and a text-wide regex cannot tell that
 * quote from a step. `yaml`'s `parse` already drops every comment before
 * this ever sees the document, which is what rules that out structurally
 * rather than by pattern.
 * @param {string} workflowYaml
 * @returns {PnpmInvocation[]}
 */
export const workflowPnpmInvocations = (workflowYaml) => {
  const jobs = parse(workflowYaml)?.jobs ?? {};
  /** @type {PnpmInvocation[]} */
  const invocations = [];
  for (const job of Object.values(jobs)) {
    for (const step of job?.steps ?? []) {
      if (typeof step.run !== 'string') continue;
      for (const statement of statements(step.run)) {
        const invocation = pnpmInvocation(statement);
        if (invocation) invocations.push(invocation);
      }
    }
  }
  return invocations;
};

/**
 * @param {PnpmInvocation} invocation
 * @returns {string}
 */
const invocationKey = (invocation) =>
  invocation.form === 'script'
    ? `script:${invocation.script}`
    : invocation.form === 'filter'
      ? `filter:${invocation.filter}:${invocation.script}`
      : invocation.form === 'exec'
        ? `exec:${invocation.command}`
        : `unrecognized:${invocation.statement}`;

/**
 * Every `pnpm` invocation `workflowYaml` makes that is named in neither
 * `steps` nor `exclusions` -- a gate CI runs that `pnpm verify` does not run
 * and nobody decided to leave out. Pure over its inputs, so a test can feed
 * it a fixture workflow and a fixture list without touching the real ones.
 * An `unrecognized` invocation's key is its whole statement text, which
 * nothing in `steps` or `exclusions` declares, so it is always reported --
 * the fail-closed guard against a `pnpm` shape this module cannot read.
 * @param {string} workflowYaml
 * @param {{ invocation: PnpmInvocation }[]} steps
 * @param {{ invocation: PnpmInvocation }[]} exclusions
 * @returns {PnpmInvocation[]}
 */
export const driftProblems = (workflowYaml, steps, exclusions) => {
  const known = new Set(
    [...steps, ...exclusions].map((entry) => invocationKey(entry.invocation))
  );
  const reported = new Set();
  /** @type {PnpmInvocation[]} */
  const problems = [];
  for (const invocation of workflowPnpmInvocations(workflowYaml)) {
    const key = invocationKey(invocation);
    if (known.has(key) || reported.has(key)) continue;
    reported.add(key);
    problems.push(invocation);
  }
  return problems;
};

/**
 * Every CI gate `pnpm verify` runs, in the order .github/workflows/ci.yml's
 * own jobs run them (`static`, `audit`, `unit`, `package`, `site`,
 * `storybook`) and stopping at the first failure. Each entry's `invocation`
 * is what `driftProblems` matches against the workflow's own `pnpm` calls --
 * a step added here without one is a step the drift check cannot see, which
 * defeats the reason this list and EXCLUSIONS sit side by side in this file.
 * @type {{ name: string, command: string[], invocation: PnpmInvocation }[]}
 */
export const STEPS = [
  {
    name: 'format:check',
    command: ['pnpm', 'format:check'],
    invocation: { form: 'script', script: 'format:check' }
  },
  {
    name: 'lint',
    command: ['pnpm', 'lint'],
    invocation: { form: 'script', script: 'lint' }
  },
  {
    name: 'typecheck',
    command: ['pnpm', 'typecheck'],
    invocation: { form: 'script', script: 'typecheck' }
  },
  {
    name: 'test:docs',
    command: ['pnpm', 'test:docs'],
    invocation: { form: 'script', script: 'test:docs' }
  },
  {
    name: 'test:audit-unit',
    command: ['pnpm', 'test:audit-unit'],
    invocation: { form: 'script', script: 'test:audit-unit' }
  },
  {
    name: 'test:story-fixtures',
    command: ['pnpm', 'test:story-fixtures'],
    invocation: { form: 'script', script: 'test:story-fixtures' }
  },
  {
    name: 'docs:check',
    command: ['pnpm', 'docs:check'],
    invocation: { form: 'script', script: 'docs:check' }
  },
  {
    name: 'test:changesets',
    command: ['pnpm', 'test:changesets'],
    invocation: { form: 'script', script: 'test:changesets' }
  },
  {
    name: 'test:audit',
    command: ['pnpm', 'test:audit'],
    invocation: { form: 'script', script: 'test:audit' }
  },
  {
    name: 'test',
    command: ['pnpm', 'test'],
    invocation: { form: 'script', script: 'test' }
  },
  {
    name: 'build',
    command: ['pnpm', 'build'],
    invocation: { form: 'script', script: 'build' }
  },
  {
    name: 'test:packages',
    command: ['pnpm', 'test:packages'],
    invocation: { form: 'script', script: 'test:packages' }
  },
  {
    name: 'test:budgets',
    command: ['pnpm', 'test:budgets'],
    invocation: { form: 'script', script: 'test:budgets' }
  },
  {
    name: 'test:bundle',
    command: ['pnpm', 'test:bundle'],
    invocation: { form: 'script', script: 'test:bundle' }
  },
  {
    name: 'test:integrations',
    command: ['pnpm', 'test:integrations'],
    invocation: { form: 'script', script: 'test:integrations' }
  },
  {
    name: 'docs:bytes:check',
    command: ['pnpm', 'docs:bytes:check'],
    invocation: { form: 'script', script: 'docs:bytes:check' }
  },
  {
    name: 'compare:libraries:check',
    command: ['pnpm', 'compare:libraries:check'],
    invocation: { form: 'script', script: 'compare:libraries:check' }
  },
  {
    name: 'compare:features:check',
    command: ['pnpm', 'compare:features:check'],
    invocation: { form: 'script', script: 'compare:features:check' }
  },
  {
    // The `site` job's own build, ahead of the three checks below that read
    // it -- `pnpm exec turbo run build --filter=@playdeck/site...`, not
    // `pnpm --filter @playdeck/site build`: the trailing `...` is what pulls
    // in the packages the site imports through its published entry (see
    // .github/workflows/ci.yml's `site` job).
    name: 'site build',
    command: [
      'pnpm',
      'exec',
      'turbo',
      'run',
      'build',
      '--filter=@playdeck/site...'
    ],
    invocation: {
      form: 'exec',
      command: 'turbo run build --filter=@playdeck/site...'
    }
  },
  {
    name: 'test:site-analytics',
    command: ['pnpm', 'test:site-analytics'],
    invocation: { form: 'script', script: 'test:site-analytics' }
  },
  {
    name: 'test:site-links',
    command: ['pnpm', 'test:site-links'],
    invocation: { form: 'script', script: 'test:site-links' }
  },
  {
    name: 'test:site-fences',
    command: ['pnpm', 'test:site-fences'],
    invocation: { form: 'script', script: 'test:site-fences' }
  },
  {
    name: 'storybook build',
    command: ['pnpm', '--filter', '@playdeck/storybook', 'build'],
    invocation: {
      form: 'filter',
      filter: '@playdeck/storybook',
      script: 'build'
    }
  },
  {
    name: 'test:storybook',
    command: ['pnpm', 'test:storybook'],
    invocation: { form: 'script', script: 'test:storybook' }
  }
];

/**
 * `pnpm` invocations .github/workflows/ci.yml makes that `pnpm verify`
 * deliberately does not run, each with the reason. This is what
 * `driftProblems` treats as settled rather than a step the list below
 * forgot -- a `pnpm` call in CI that is in neither STEPS nor here is the
 * drift this file's test guards against.
 * @type {{ name: string, invocation: PnpmInvocation }[]}
 */
export const EXCLUSIONS = [
  {
    // Whoever runs `pnpm verify` already has `node_modules`, the same way
    // whoever runs any other pnpm script in this repo does.
    name: 'install',
    invocation: { form: 'script', script: 'install' }
  },
  {
    // Browser-bound and slow, and run in its own CI jobs rather than here
    // -- #871's brief excludes it by name.
    name: 'test:e2e',
    invocation: { form: 'script', script: 'test:e2e' }
  }
];

/**
 * The exit code to use when `main` throws -- `execFileSync`'s own
 * `status` when a step's command exited non-zero, `1` for anything else
 * (a thrown `Error`, a missing binary), so `pnpm verify` still exits
 * non-zero rather than 0.
 * @param {unknown} error
 * @returns {number}
 */
const exitCodeOf = (error) =>
  typeof error === 'object' &&
  error !== null &&
  'status' in error &&
  typeof error.status === 'number'
    ? error.status
    : 1;

/**
 * Thrown by `main` when a step's own command exits non-zero, naming the
 * step and its exit code -- the progress line `main` prints before running
 * a step is easy to scroll past, and `execFileSync`'s own error names the
 * command it ran rather than this file's step name.
 */
class StepFailure extends Error {
  /** @type {number} */
  status;

  /**
   * @param {string} name
   * @param {number} status
   */
  constructor(name, status) {
    super(`verify: step \`${name}\` failed (exit ${status})`);
    this.status = status;
  }
}

const main = () => {
  const workflowYaml = readFileSync(
    new URL('../.github/workflows/ci.yml', import.meta.url),
    'utf8'
  );
  const problems = driftProblems(workflowYaml, STEPS, EXCLUSIONS);
  if (problems.length > 0) {
    throw new Error(
      `.github/workflows/ci.yml runs a pnpm command that pnpm verify's STEPS list and EXCLUSIONS list both leave out:\n${problems
        .map((problem) => `  ${JSON.stringify(problem)}`)
        .join('\n')}`
    );
  }

  for (const step of STEPS) {
    console.log(`\n> ${step.name}`);
    try {
      execFileSync(step.command[0], step.command.slice(1), {
        cwd: repoRoot,
        stdio: 'inherit'
      });
    } catch (error) {
      throw new StepFailure(step.name, exitCodeOf(error));
    }
  }
  console.log(`\nAll ${STEPS.length} verify steps passed.`);
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(
      `\n${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(exitCodeOf(error));
  }
}
