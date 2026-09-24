# The token table's canonical copy lives in the package README, not Theme.mdx

Supersedes [ADR-0001](0001-structural-css-ships-inline.md) and
[ADR-0002](0002-published-measurements-are-outputs.md) on where the token
table lives. Everything else either decided stands: ADR-0001's three-entry
boundary for structural CSS (inline on the primitive, a token with an inline
`var()` default, or `theme.css`) is unchanged, and so is ADR-0002's argument
that a published measurement is an output and not a token because it runs the
opposite direction — a primitive reads a token, and writes an output. Only the
address of the table itself moves.

Both ADRs point at that address in passing rather than deciding it: ADR-0001
says a token is "documented in `theme.css`'s token table", and ADR-0002 argues
that a published property does not belong there because "`Theme.mdx` presents
its table as the values you may **set**". Both were accurate descriptions of
where the one rendered, versioned table of every token's name, role, default
and reading parts actually lived at the time — in `apps/storybook/stories/Theme.mdx`,
behind a published Storybook neither ADR revisits — and neither treated the
address as a decision worth its own heading.

#666 moved that table. It now lives in `packages/react/README.md`'s
`## Theming` section, and `test/tokens.contract.test.ts` checks it in both
directions against the rules in `theme.css`, `docked.css` and every primitive
in `packages/react/src` — the same two-way shape
`apps/storybook/stories/parts.contract.test.ts` already used for parts.
`Theme.mdx` carries no table of its own any more; its **Tokens** section links
to the README's table instead, rendered by the site as that package's own
reference page rather than as a trip off it (`apps/site/src/guide-pages.mjs`
rewrites the GitHub URL a Storybook document has to write into one).

The reason is the same test-ability argument ADR-0001 and ADR-0002 already
apply to everything else here: a table that ships inside the npm tarball, next
to the source it describes, is the one copy a mechanical check can hold
against that source on every run. A table living only behind a published
Storybook could not be — `test/tokens.contract.test.ts` reads
`packages/react/README.md` off disk in the same package, which is also read by
whoever installs `@playdeck/react` and never opens this repository's site or
workbench at all.

## What is not the canonical copy

`theme.css`'s own header comment used to carry a second, shorter token list —
names and defaults only, no role or parts column. It predated this decision,
answered a different question ("what does this file ship with no import"
inside the file itself), and nothing checked it against the README's table or
against the file's own rules: it was missing the four
`--playdeck-caption-*` tokens and wrong about `--playdeck-radius`
(`packages/react/README.md`'s own row on that token records the mismatch).
Nothing here retired it — an untested second copy inside a file that ships to
every consumer already, its cost was a known, recorded gap rather than a new
one, and closing it was a separate change to `theme.css` this repository was
not making alongside this documentation move. #734 later made that change,
deleting the list and leaving the header pointing at this table instead.

## Consequences

- A token's role, default and reading parts have exactly one place a consumer
  or a contributor should trust: `packages/react/README.md`'s `## Theming`
  table, checked by `test/tokens.contract.test.ts`. `Theme.mdx`'s guide page
  and `theme.css`'s header comment are prose about it, not copies of it.
- A future edit to what a token means, or which parts read it, is a README
  edit. Editing `Theme.mdx` instead would change what the guide says without
  changing what ships, and editing `theme.css`'s header alone changes neither
  the README nor the test.
