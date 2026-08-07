// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { cssBackgroundImageViolations } from './background-image-scan';

// The CSS half of the split described in eslint.config.js and
// poster.spec.ts's "CSS source files do not declare background images":
// a comment-stripped text scan, because no CSS linter exists in this repo.
// This is a vitest unit test rather than a Playwright spec so it runs under
// `pnpm test` without a Storybook build — it needs no browser, only the pure
// string-in/string-out seam extracted into background-image-scan.ts.
//
// Named `*.contract.test.ts` and excluded from Playwright's own collection by
// the `testIgnore` on the chromium/firefox/webkit projects in
// playwright.config.ts (the `visual` project already excludes it by using
// `testMatch` instead). Picked up by vitest via the `e2e/*.contract.test.ts`
// entry in vitest.config.ts's `include`.
describe('the background-image CSS text scan (comments stripped)', () => {
  it('fails on a real background-image declaration', () => {
    const violations = cssBackgroundImageViolations(
      '.poster {\n  background-image: url(/x.png);\n}\n',
      'fixture.css'
    );

    expect(violations).toEqual(['fixture.css:2: background-image']);
  });

  it('does not fail when background-image only appears inside /* */', () => {
    const violations = cssBackgroundImageViolations(
      '/* background-image */\n.poster {\n  color: red;\n}\n',
      'fixture.css'
    );

    expect(violations).toEqual([]);
  });

  // Blanking a matched comment character-by-character (rather than deleting
  // the substring) keeps every line, including everything after a
  // multi-line comment, at its original line number. Deleting the substring
  // would collapse the comment's newlines and shift this declaration up by
  // three lines, misreporting where it actually is.
  it('reports the correct line number for a declaration after a stripped multi-line comment', () => {
    const source = [
      ':root {',
      '  /* a comment mentioning',
      '     background-image',
      '     across several lines */',
      '}',
      '',
      '.poster {',
      '  background-image: url(/x.png);',
      '}',
      ''
    ].join('\n');

    const violations = cssBackgroundImageViolations(source, 'fixture.css');

    expect(violations).toEqual(['fixture.css:8: background-image']);
  });
});
