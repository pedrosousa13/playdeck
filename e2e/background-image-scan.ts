// The CSS half of the background-image gate (see poster.spec.ts's "CSS
// source files do not declare background images"). CSS has exactly one
// comment form and no string-escaping hazard, so a regex strip is correct
// here in a way it would not be for TypeScript (which gets an AST-based
// ESLint rule instead, in eslint.config.js).
//
// A matched comment is blanked out character-by-character rather than
// removed, with newlines left untouched. That keeps every surviving line at
// its original line number, including the lines inside a multi-line comment
// and everything after it — removing the substring instead would shift every
// following line up and make the guard misreport where a real declaration
// is.
const stripCssComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, (comment) =>
    comment.replace(/[^\n]/g, ' ')
  );

const backgroundImagePattern = /background-image/g;

export const cssBackgroundImageViolations = (
  source: string,
  file: string
): string[] =>
  stripCssComments(source)
    .split(/\r?\n/)
    .flatMap((line, index) =>
      Array.from(
        line.matchAll(backgroundImagePattern),
        (match) => `${file}:${index + 1}: ${match[0]}`
      )
    );
