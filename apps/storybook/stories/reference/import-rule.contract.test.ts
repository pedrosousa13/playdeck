// @vitest-environment node
import { fileURLToPath, URL } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// The rule exists because convention has already failed twice (#15, #73), and
// because #73's own rule shipped accepting `exact: false` on its first attempt:
// it was only ever tested for the presence of a key, never seen to reject
// anything. This asserts both halves of the rule, on every run.
const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));

const lintSpecifier = async (specifier: string): Promise<readonly string[]> => {
  const eslint = new ESLint({ cwd: repoRoot });
  // A side-effect import, not `import x from ...`: no-restricted-imports
  // matches on the specifier string alone, and a bound-but-unused `x` would
  // trip @typescript-eslint/no-unused-vars on every probe, which has nothing
  // to do with the rule under test.
  const [result] = await eslint.lintText(`import '${specifier}';\n`, {
    filePath: 'apps/storybook/stories/reference/probe.tsx',
    warnIgnored: false
  });
  return (result?.messages ?? []).map((message) => message.ruleId ?? 'unknown');
};

const accepted = [
  '@reely/react',
  '@reely/core',
  'react',
  'react/jsx-runtime',
  '@storybook/react-vite',
  'storybook/test',
  './reference-player'
];

const rejected = [
  // The #15/#73 shapes: reaching out of the example at all.
  '../support',
  '../../.storybook/mock-player',
  '../../../packages/react/theme.css',
  '@reely/react/src/index',
  // Composing against a provider package is not composing against the
  // public React surface.
  '@reely/provider-hls',
  'hls.js'
];

describe('the reference example may only import public exports', () => {
  it.each(accepted)('accepts %s', async (specifier) => {
    expect(await lintSpecifier(specifier)).toEqual([]);
  });

  it.each(rejected)('rejects %s', async (specifier) => {
    expect(await lintSpecifier(specifier)).toContain('no-restricted-imports');
  });
});
