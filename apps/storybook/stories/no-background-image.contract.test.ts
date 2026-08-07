// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { join } from 'node:path';
import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

// A poster must be a real <img>/<picture> element, never a CSS
// background-image (see e2e/poster.spec.ts for why). That gate used to read
// raw source text and could not tell a declaration from a comment about one
// (#184). This proves the JS/JSX/TS/TSX half it was rewritten into: an
// AST-based no-restricted-syntax rule where a comment cannot trip it, because
// comments are not nodes. The CSS half's own contract test is
// e2e/background-image-scan.contract.test.ts — its module cannot be imported
// from here: the `e2e` TypeScript project is deliberately `noEmit` (like
// `scripts` and `tests`, it is never a type source for another project), and
// a project that imports from another project requires that project to
// emit declarations. Importing e2e/background-image-scan.ts from here errors
// with TS6310 ("Referenced project may not disable emit"). The root
// tsconfig.json does list `{ "path": "./e2e" }`, but that is build-order
// aggregation for `tsc -b`, not a type-consuming import, so it hits no such
// rule.
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

// The exact message text per selector, from eslint.config.js — asserted
// verbatim (not just "some message fired") so a selector regression that
// fires the wrong entry, or fires on the wrong node, cannot pass silently.
const propertyMessage =
  'A poster must be a real <img>/<picture> element, never a CSS background-image: this object property sets one. If this is prose about the property rather than a live style, move it into a comment. See e2e/poster.spec.ts.';
const assignmentMessage =
  'A poster must be a real <img>/<picture> element, never a CSS background-image: this assignment sets one. If this is prose about the property rather than a live style, move it into a comment. See e2e/poster.spec.ts.';
const literalMessage =
  'A poster must be a real <img>/<picture> element, never a CSS background-image: this string/template text contains one. If this is prose about the property rather than CSS text, move it into a comment. See e2e/poster.spec.ts.';

// Scoped to this rule's own message text so an unrelated no-restricted-syntax
// or parser message (e.g. from the reactHooks or e2e Playwright-selector
// blocks) never counts as a hit or a miss for this gate.
const backgroundImageMessages = async (
  code: string,
  filePath: string
): Promise<readonly string[]> => {
  const [result] = await eslint.lintText(code, {
    filePath,
    warnIgnored: false
  });
  return (result?.messages ?? [])
    .filter(
      (message) =>
        message.ruleId === 'no-restricted-syntax' &&
        message.message.includes('never a CSS background-image')
    )
    .map((message) => `${filePath}:${message.line}: ${message.message}`);
};

const lintRealFile = (relativePath: string): Promise<readonly string[]> =>
  backgroundImageMessages(
    readFileSync(join(repoRoot, relativePath), 'utf8'),
    relativePath
  );

// Paid once in `beforeAll` on its own timeout, for the same reason as
// stories/reference/import-rule.contract.test.ts: resolving the flat config
// pulls in the whole plugin graph, which costs seconds cold and milliseconds
// after. Declared below the two helpers above so a future switch to a
// top-level `await` here can't land in their temporal dead zone.
let eslint: ESLint;

beforeAll(async () => {
  eslint = new ESLint({ cwd: repoRoot });
  await backgroundImageMessages(
    'export const probe = 0;\n',
    'apps/storybook/stories/fixtures/probe.tsx'
  );
}, 60_000);

describe('the background-image AST rule (JS/JSX/TS/TSX)', () => {
  it('flags an object property named backgroundImage, e.g. in a style prop', async () => {
    const filePath =
      'apps/storybook/stories/fixtures/background-image-property.tsx';
    const messages = await backgroundImageMessages(
      `export const Fixture = () => (
        <div style={{ backgroundImage: 'url(/x.png)' }} />
      );\n`,
      filePath
    );

    expect(messages).toEqual([`${filePath}:2: ${propertyMessage}`]);
  });

  it('flags an assignment to a .style.backgroundImage member', async () => {
    const filePath =
      'packages/react/src/fixtures/background-image-assignment.ts';
    const messages = await backgroundImageMessages(
      `declare const element: HTMLElement;
      element.style.backgroundImage = 'url(/x.png)';\n`,
      filePath
    );

    expect(messages).toEqual([`${filePath}:2: ${assignmentMessage}`]);
  });

  it('flags a bracket-notation assignment to a .style["backgroundImage"] member', async () => {
    const filePath =
      'packages/react/src/fixtures/background-image-bracket-assignment.ts';
    const messages = await backgroundImageMessages(
      `declare const element: HTMLElement;
      element.style['backgroundImage'] = 'url(/x.png)';\n`,
      filePath
    );

    expect(messages).toEqual([`${filePath}:2: ${assignmentMessage}`]);
  });

  it('flags a string literal containing background-image', async () => {
    const filePath = 'packages/react/src/fixtures/background-image-string.ts';
    const messages = await backgroundImageMessages(
      `declare const element: HTMLElement;
      element.style.setProperty('background-image', 'url(/x.png)');\n`,
      filePath
    );

    expect(messages).toEqual([`${filePath}:2: ${literalMessage}`]);
  });

  it('flags a template literal containing background-image', async () => {
    const filePath = 'packages/react/src/fixtures/background-image-template.ts';
    const messages = await backgroundImageMessages(
      'export const css = `background-image: url(/x.png)`;\n',
      filePath
    );

    expect(messages).toEqual([`${filePath}:1: ${literalMessage}`]);
  });

  it('does not flag the same identifier inside a // comment', async () => {
    const messages = await backgroundImageMessages(
      `// backgroundImage should never leak into inline styles: background-image
      export const noop = (): void => undefined;\n`,
      'packages/react/src/fixtures/background-image-line-comment.ts'
    );

    expect(messages).toEqual([]);
  });

  it('does not flag the same identifier inside a /* */ comment', async () => {
    const messages = await backgroundImageMessages(
      `/* backgroundImage, background-image */
      export const noop = (): void => undefined;\n`,
      'packages/react/src/fixtures/background-image-block-comment.ts'
    );

    expect(messages).toEqual([]);
  });

  it('does not flag the poster inline-style assertion in packages/react/test/index.test.tsx', async () => {
    expect(await lintRealFile('packages/react/test/index.test.tsx')).toEqual(
      []
    );
  });

  it("does not widen its scope into e2e/, where background-image-scan.ts's backgroundImagePattern regex lives", async () => {
    expect(await lintRealFile('e2e/background-image-scan.ts')).toEqual([]);
  });
});
