#!/usr/bin/env node
// Keeps the docs' code examples honest: every `ts`/`tsx` block inside an
// `example:` marker is generated from a real file in `examples/`, which the
// `examples` tsconfig project compiles against the built declarations. Prose
// and code cannot drift, because the code is not written in the prose.

/**
 * @typedef {{ source: string; language: 'ts' | 'tsx' }} Fixture
 */

// `.mdx` cannot carry HTML comments — MDX 2 parses them as JSX and fails — so
// the two syntaxes differ. Storybook's MDX is v3.
export const MARKERS = {
  md: {
    open: /^<!-- example:([a-z0-9-]+) -->$/,
    close: /^<!-- \/example -->$/
  },
  mdx: {
    open: /^\{\/\* example:([a-z0-9-]+) \*\/\}$/,
    close: /^\{\/\* \/example \*\/\}$/
  }
};

/**
 * @param {string} text
 * @param {'md' | 'mdx'} syntax
 * @param {Map<string, Fixture>} fixtures
 * @returns {string}
 */
export const renderDoc = (text, syntax, fixtures) => {
  const marker = MARKERS[syntax];
  const lines = text.split('\n');
  /** @type {string[]} */
  const out = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const opened = marker.open.exec(line);
    if (!opened) {
      out.push(line);
      continue;
    }

    const name = opened[1] ?? '';
    const fixture = fixtures.get(name);
    if (!fixture) {
      throw new Error(
        `Marker example:${name} has no fixture named "${name}" in examples/.`
      );
    }

    const end = lines.findIndex(
      (candidate, at) => at > index && marker.close.test(candidate)
    );
    if (end === -1) {
      throw new Error(`Marker example:${name} is never closed.`);
    }

    out.push(
      line,
      '',
      `\`\`\`${fixture.language}`,
      fixture.source.trimEnd(),
      '```',
      '',
      lines[end] ?? ''
    );
    index = end;
  }

  return out.join('\n');
};
