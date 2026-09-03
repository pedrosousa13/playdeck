# The deployed artifact is the site alone

Supersedes [ADR-0006](0006-publishing-is-a-committed-configuration-on-an-apex-domain.md)
on what is deployed. Everything else that ADR decided stands: publishing is a
Cloudflare Worker serving static assets, driven from a workflow against a
`wrangler.jsonc` committed at the repository root, onto the apex
`playdeck.video`, with GitHub Pages retired. Only the contents of the artifact
change here.

ADR-0006 recorded a deployment carrying two surfaces — `apps/site` at the root,
the Storybook workbench one segment inside it at `/storybook/`. The workbench
was there because of #435: `README.md` said the workbench **was** the
documentation, and with no hosted build the primary documentation was reachable
only by cloning the monorepo and running a full workspace install, which
somebody who ran `pnpm add @playdeck/react` has no reason and no instruction to
do. Publishing it made the README's claim true.

The maintainer decided (2026-08-29) that a component workbench is not a
documentation site and should not be served publicly. That leaves #435's
argument to answer some other way, and #533 answered it: the documents a
consumer is sent to are now rendered by the site, from the same MDX sources
under `apps/storybook/stories/` rather than from a copy, and every published
link points at the site's rendering of them. #540 then took the workbench out of
the site's navigation. So by the time this decision is implemented, nothing a
consumer is pointed at requires the workbench to be served.

**The deployed artifact is `apps/site` and nothing else.** The workbench stays
in the repository, builds, and runs — it is a development tool for this
repository, and its stories remain browser tests. Nothing publishes it.

## Consequences

- `scripts/assemble-deploy.mjs` composes one build rather than two, and no
  longer describes a layout: there is one source and one destination. It stays a
  script rather than becoming a `cp` line in the workflow, because
  `scripts/check-deploy-artifact.mjs` imports it, and one definition is what
  keeps the harness from going green against a shape the deploy no longer
  produces.
- `pnpm test:deploy` proves one surface. It builds the site the way the workflow
  builds it, assembles it, serves it at an origin root with a miss answered as a
  404, and drives Chromium through the landing page and every internal link it
  carries. What it no longer does is click the workbench's own sidebar to a
  story, which was the expensive half.
- The check tolerates nothing now. Its two tolerances — an aborted preview
  iframe and a manager diagnostic — were both the workbench making noise about
  itself, and the reasoning for keeping them narrow was that a widened tolerance
  would drop a wrong-prefix asset abandoned by a navigation. With the workbench
  gone there is nothing to tolerate, so an aborted request is a finding again
  and the waits that make it one are what the visits are careful about.
- `scripts/check-site-links.mjs` had an exemption for addresses under a surface
  the site's own build does not contain, derived from the assembly's layout so
  that it would move when the mount did. There is no such surface, so the
  exemption is gone and every internal link the site emits must resolve inside
  `apps/site/dist`. A link into `/storybook/` now fails that check, which is the
  gate that keeps this decision from being undone by a stray href.
- **`PLAYDECK_BASE_PATH` stays**, and its only remaining caller is a person at a
  terminal. `apps/storybook/.storybook/main.ts` still reads it into the
  bundler's `base`, and `stories/asset-url.ts` still resolves fixtures against
  that value, because building the workbench under a prefix is the only way to
  see what a root-absolute literal in a story actually does. It is the
  workbench's mechanism and only the workbench's: the site reaches its own
  prefix through Astro's `base`, which `apps/site`'s `build:based` and
  `e2e/site-search.spec.ts` already drive under `/playdeck/`. What the workflow
  no longer does is pass a value: nothing serves the workbench, so there is no
  prefix for the deploy to state. `apps/storybook/README.md` carries the
  reasoning, which is where a reader meets the mechanism.
- **The prefix check is a static scan now, not a browser one.** Building the
  workbench under a prefix and driving a browser through it is what caught a
  story addressing a fixture with a root-absolute literal instead of going
  through `stories/asset-url.ts`. That harness built the workbench because the
  deploy published it; it no longer builds it, so that check is gone. #583
  replaced it with the cheaper thing this bullet used to ask for:
  `scripts/story-fixtures.mjs`, run as `pnpm test:story-fixtures` in the
  `static` job, reads the stories and reports every root-absolute literal that
  names a file under `apps/storybook/public/`. Scoping it to the fixture tree
  is what keeps it from needing an ignore list for the literals a story means
  to leave unresolvable. It catches the authoring mistake directly rather than
  its symptom, and that is all it catches: no build runs, so nothing here shows
  that the workbench works under a prefix. Seeing that is still the pair of
  commands in `apps/storybook/README.md`, run by a person.
- `wrangler.jsonc`'s `html_handling` default is unchanged and its justification
  is not. It used to be the setting that made `/storybook/` serve
  `storybook/index.html`; it is now the setting that makes every Astro route
  serve the `index.html` inside its directory, and that redirects the
  slash-less form onto it. The site's build format is what the default agrees
  with, and the file argues the alternatives from that rather than from the
  workbench.
- The site's build is now the only thing between a merge and what
  `playdeck.video` serves. A workbench that fails to build no longer fails a
  deploy — `ci.yml` is what catches it, on the pull request, which is earlier
  and is where it belonged.
