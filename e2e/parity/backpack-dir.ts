import { existsSync } from 'node:fs';

// Fact verified by hand before this harness was written (see the plan's
// "Facts verified before this plan was written"): a v4 beta checkout here
// builds and serves. Not re-derived — just the default a caller can override.
const DEFAULT_BACKPACK_DIR = '/Users/pedrosousa/Documents/apps/backpack/beta';
const ENV_VAR = 'REELY_BACKPACK_DIR';

/**
 * Resolves the local Backpack checkout the parity harness serves its
 * Storybook from. A missing directory fails loudly rather than letting the
 * harness silently skip the Backpack side and report nothing — a harness
 * that reports nothing looks the same as one that passes.
 */
export function resolveBackpackDir(
  env: NodeJS.ProcessEnv = process.env
): string {
  const dir = env[ENV_VAR] ?? DEFAULT_BACKPACK_DIR;
  if (!existsSync(dir)) {
    throw new Error(
      `Backpack checkout not found at "${dir}". Set ${ENV_VAR} to a Backpack v4 beta checkout (default: ${DEFAULT_BACKPACK_DIR}).`
    );
  }
  return dir;
}
