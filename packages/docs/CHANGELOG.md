# @playdeck/docs

## 1.4.0

### Patch Changes

- edeeadb: Each package's README, and every page `@playdeck/docs` publishes from it, holds no em dash (U+2014): a colon, a comma, parentheses or a full stop carries the same sentence instead. `scripts/docs-package.mjs --check` refuses to publish a page that holds one, naming the file and line.
- 72c2127: Publish `@playdeck/docs`: the guides, reference, provider setup, start and examples pages as markdown, for the deck.cool site to build playdeck's pages from. It is versioned with `@playdeck/react` in the fixed group, and each live player is a `<!-- demo:<name> -->` marker, `streaming-service` and `course-platform`.
- 470f455: The comparison guide's opening paragraph says the page is rendered into `@playdeck/docs` by `scripts/comparison-page.mjs`.

## 1.3.0

- The first version of `@playdeck/docs`, at the version `@playdeck/react` carries. It is published once by hand, to set up the package's trusted publisher on npm; the release workflow publishes every version after it.
