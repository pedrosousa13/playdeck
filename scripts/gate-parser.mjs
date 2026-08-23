// The YAML parser the gate scripts read `pnpm-workspace.yaml` with, and the
// only place any of them names a third-party package at all. See #372.
//
// A pinned run -- `node .gate/audit.mjs`, `node .gate/verify-packaging.mjs` --
// executes `main`'s copy of a gate's *source* over the pull request's tree. A
// bare specifier is not part of that source. Node resolves one by walking
// `node_modules` upward from the importing file, so `import { parse } from
// 'yaml'` inside `.gate/` lands in the pull request's own installed tree, and a
// pull request that redirects the name -- an `overrides` entry, or a workspace
// package taking it -- runs its own top-level code inside `main`'s gate.
// Demonstrated on the branch that found it: a stub `parse` returning `{}` hides
// both blocks scripts/audit.mjs reads out of `pnpm-workspace.yaml`, and the
// pinned run reports a clean tree over one carrying a real violation.
//
// So .github/workflows/ci.yml gives the gate its own copy of the parser next to
// the pinned source, at the version `main` pins, and names the directory it put
// it in in `PLAYDECK_GATE_MODULES`. Upward resolution reaches that directory
// first and stops there. This module is what proves it did.
//
// "Gives" rather than "installs", and the distinction is worth a line because
// it is the sort of thing that gets tidied back: the workflow fetches the
// package with `npm pack` and unpacks the tarball, because `npm install` on
// npm 11 asks about its supply-chain policy check and, measured, can exit 0
// having installed nothing. ci.yml carries the numbers. `yaml` declares no
// dependencies, so the unpacked tarball is the whole of what an install would
// have produced.
//
// The proof is here rather than in the workflow step for two reasons. It is the
// resolution *this module* performs that has to be checked, and a bare specifier
// resolves from the importing file's own directory -- a check run anywhere else
// answers a neighbouring question about a different directory in a different
// process. And this file travels in the same `git archive` as the gates, so the
// check is pinned exactly as their logic is: a pinned run that acquires a new
// YAML reader gets it by importing this module, which is the only import of
// `yaml` there is.
//
// The import below is dynamic, and that is load-bearing rather than a style
// choice. A static import is evaluated before any statement in this file, so a
// parser resolved from the wrong place would already have run its top-level
// code by the time the check reported it -- and code that runs first can silence
// whatever checks it afterwards, which is exactly what the demonstration above
// did to `process.exit`. `import.meta.resolve` answers where the specifier
// points without loading anything, so nothing from the wrong directory executes
// at all.
//
// Set means mandatory, the rule `PLAYDECK_PUBLISHABLE_BASELINE` already follows
// in scripts/audit.mjs: a named directory that cannot be read, or a parser that
// resolved outside it, throws rather than falling back to whatever the tree
// offers. A check that quietly accepts the copy it exists to avoid is the defect
// it was added for. Unset is the developer's path and only the developer's path
// -- `pnpm test:audit` and `pnpm test:packages` from a working tree resolve
// `yaml` out of the repository's own `node_modules`, which is what CI's second,
// unpinned run of each gate resolves too.
//
// One import is covered, because one is provided. `.gate/verify-packaging.mjs`
// also imports `@playwright/test`, which is not provided for the gate and is
// not reached from here; .github/workflows/ci.yml states that residual in the
// job that runs it.

import { realpathSync } from 'node:fs';
import { sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const process = globalThis.process;

const gateModules = process.env.PLAYDECK_GATE_MODULES;
if (gateModules) {
  // Both sides are realpath'd because otherwise only one of them would be:
  // Node resolves symlinks while resolving a module, so a checkout reached
  // through one would compare a real path against a symlinked one and fail a
  // gate that is behaving. `realpathSync` on the named directory is also what
  // turns a runtime that never arrived into an error here rather than a
  // comparison against a path that is not there.
  const parser = realpathSync(fileURLToPath(import.meta.resolve('yaml')));
  const installed = realpathSync(gateModules) + sep;
  if (!parser.startsWith(installed)) {
    throw new Error(
      `The gate's YAML parser resolved to ${parser}, which is not inside the runtime installed for the gate at ${installed}. A pinned gate must not read the tree it is judging for the code it executes -- see #372.`
    );
  }
}

export const { parse, parseDocument } = await import('yaml');
