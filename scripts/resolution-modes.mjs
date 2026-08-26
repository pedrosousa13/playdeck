// The consumer `moduleResolution` settings this repo has an answer for, and
// what each one has to do when a consumer-shaped project is pointed at the
// packed artifacts.
//
// This is the one table of them. `scripts/verify-packaging.mjs` type-checks the
// packaging fixture under every entry below against the installed tarballs, and
// `scripts/esm-only-guard.test.mjs` runs the supported entries against a
// stubbed install tree to establish which file the export map sends each mode
// to. The two gates ask different questions of the same set, so adding or
// retiring a mode is an edit here and nowhere else.
//
// That last sentence is a design constraint on the fixture rather than a
// description of it: `tests/packaging/fixture/tsconfig.json` is the consumer
// configuration every mode is checked under, and it deliberately selects no
// mode of its own -- the harness writes `module` and `moduleResolution` into a
// config extending it, once per entry below. A base that set them too would be
// a second place to edit, and an inert one, since every generated config
// overrides it. `scripts/resolution-modes.test.mjs` holds it to that.
//
// A mode these packages do not claim is marked `unsupported` rather than
// omitted, and that is the half a "the supported ones still work" check cannot
// supply. Export maps are what these packages steer resolution with, and node10
// ignores export maps entirely, so it cannot reach the declarations -- which is
// also what `attw --profile esm-only` mutes that row for. If a mode marked here
// ever started resolving, something would have been added outside the export
// map, which is a consumer-visible change nobody asked for and nothing else
// here would see.

/**
 * @typedef {object} ResolutionMode
 * @property {'module'} [type] the `type` of the consumer manifest the mode
 *   belongs with, where the mode's answer depends on it.
 * @property {Record<string, string>} compilerOptions what a consumer writes
 *   into their own `tsconfig.json` to select the mode.
 * @property {true} [unsupported] set on a mode the packages do not claim, which
 *   has to fail rather than resolve. Optional because most modes are claimed,
 *   not because only one mode may carry it.
 */

/** @type {Readonly<Record<string, ResolutionMode>>} */
export const resolutionModes = {
  bundler: {
    compilerOptions: { module: 'esnext', moduleResolution: 'bundler' }
  },
  'esm-node16': {
    type: 'module',
    compilerOptions: { module: 'node16', moduleResolution: 'node16' }
  },
  'esm-nodenext': {
    type: 'module',
    compilerOptions: { module: 'nodenext', moduleResolution: 'nodenext' }
  },
  // `ignoreDeprecations` is load-bearing rather than housekeeping: without it
  // the compiler rejects the setting before it resolves anything, and the run
  // then fails for a reason that says nothing about these packages.
  // `resolutionProblems` below is what stops that from reading as proof.
  node10: {
    compilerOptions: {
      module: 'commonjs',
      moduleResolution: 'node10',
      ignoreDeprecations: '6.0'
    },
    unsupported: true
  }
};

/** The entries a consumer is invited to use, for gates that check only those. */
export const supportedResolutionModes = Object.fromEntries(
  Object.entries(resolutionModes).filter(([, mode]) => !mode.unsupported)
);

/**
 * What one mode's compiler run said.
 * @typedef {{ status: number; output: string }} TypecheckResult
 */

/** @param {string} text */
const escaped = (text) => text.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The diagnostic the unsupported mode owes us, and the reason this reads the
// compiler's prose rather than settling for a non-zero exit: it is the one that
// says the declarations are there and this setting cannot see them. A missing
// package, a syntax error in the fixture and a rejected compiler option all
// exit non-zero too, and none of them establishes anything about the artifact.
// A compiler release that rewords it fails this loudly, which is the trade.
/** @param {string} name */
const unresolvedUnderLegacy = (name) =>
  new RegExp(
    `error TS2307: Cannot find module '${escaped(name)}'[^\\n]*\\n` +
      `[^\\n]*could not be resolved under your current 'moduleResolution' setting`
  );

/**
 * Every way a run of `resolutionModes` failed to behave, as sentences.
 *
 * @param {readonly string[]} packageNames every package the consumer imported
 * @param {Readonly<Record<string, TypecheckResult>>} results mode -> what the
 *   compiler did, keyed by the names in `resolutionModes`
 * @returns {string[]}
 */
export const resolutionProblems = (packageNames, results) => {
  /** @type {string[]} */
  const problems = [];

  for (const [mode, { unsupported }] of Object.entries(resolutionModes)) {
    const result = results[mode];

    // A mode nobody ran is not a mode that passed.
    if (!result) {
      problems.push(`${mode} was never type-checked.`);
      continue;
    }

    if (!unsupported) {
      if (result.status !== 0) {
        problems.push(
          `${mode} is a supported resolution mode and the consumer did not type-check under it:\n${result.output}`
        );
      }
      continue;
    }

    if (result.status === 0) {
      problems.push(
        `${mode} type-checked clean. It is not a supported mode -- it ignores export maps, so it cannot reach these declarations -- and something that made it work did so outside the export map.`
      );
      continue;
    }

    for (const name of packageNames) {
      if (!unresolvedUnderLegacy(name).test(result.output)) {
        problems.push(
          `${mode} failed, but not by reporting that ${name}'s declarations exist and this setting cannot reach them, so the failure establishes nothing about the artifact:\n${result.output}`
        );
      }
    }
  }

  return problems;
};
