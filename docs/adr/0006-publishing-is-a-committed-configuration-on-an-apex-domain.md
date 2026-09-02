# Publishing runs from a configuration this repository commits, onto an apex domain

_Superseded in part by
[ADR-0007](0007-the-deployed-artifact-is-the-site-alone.md), which removed the
Storybook workbench from the deployment. What still holds is where and how
publishing runs: the committed Worker configuration, the apex domain, and the
retirement of Pages. What 0007 retires is everything below about the workbench
as a published surface — the prefix it was served under, the assembly of two
build outputs into one directory, and the harness that drove a browser through
both. Left otherwise unedited: the two-surface deployment is what was decided
here, and it ran._

Until #519 the published documentation was a GitHub Pages project site:
`.github/workflows/pages.yml` built the Storybook workbench with
`PLAYDECK_BASE_PATH` set to `/playdeck/` and uploaded
`apps/storybook/storybook-static` as the one artifact a repository gets. #519's
brief kept that shape and made room in it — "a repository has one Pages site",
so the new `apps/site` would take the root of that site and the workbench would
move one segment inside it, both still behind the project-page prefix. Mid
implementation (2026-08-29) the maintainer registered `playdeck.video` and
overrode the Pages half of that brief. Publishing moves to Cloudflare: the site
at the apex, the workbench at `/storybook/`. GitHub Pages is retired outright —
`pages.yml` is deleted, with no redirect shim left behind.

The premise is what changed, not the assembly. A real apex domain removes the
project-page prefix from the site entirely, which is why
`apps/site/astro.config.ts` sets `base: '/'` and
`.github/workflows/deploy-site.yml` hands that build no `PLAYDECK_BASE_PATH` at
all — it lands where it already defaults to. The workbench is the surface with a
prefix left to honour, and its one mechanism is unchanged: `PLAYDECK_BASE_PATH`,
read by `apps/storybook/.storybook/main.ts` into its bundler's `base`, now
`/storybook/` rather than `/playdeck/`. What did not change is that the two
surfaces are still built separately and assembled into one directory, because
neither build knows the other exists — each is handed the prefix it is served
from and nothing else. `scripts/assemble-deploy.mjs` owns that layout, and owns
it for both callers, so the deploy and the verification harness cannot disagree
about where the workbench lands.

Wrangler is driven from a workflow against a `wrangler.jsonc` committed at the
repository root, rather than through Cloudflare's dashboard Git integration.
The reasoning is `deploy-site.yml`'s and belongs here rather than only there:
the integration would move the build command, the branch that publishes and the
output directory into settings nobody can review or diff, so a change to how
this repository is published would leave no trace in it. `pages.yml` had already
made that argument for itself — it is the same refusal to leave repository state
to a settings click nobody can review, and the hosting provider changing does
not weaken it. The configuration file records what the deployment is; the
workflow records when it runs. The file sits at the root and not in `apps/site`
because the directory it publishes belongs to neither app.

## Consequences

- The deploy cannot succeed until three things land that are outside this
  repository, and all three are the maintainer's. `dig NS playdeck.video` still
  returns Porkbun's nameservers (checked 2026-08-29), so the Cloudflare zone is
  not active and the custom-domain route in `wrangler.jsonc` cannot attach;
  and neither `CLOUDFLARE_API_TOKEN` nor `CLOUDFLARE_ACCOUNT_ID` is set on the
  repository (`gh secret list` returns nothing). A run missing either secret
  fails at the Wrangler step rather than skipping, which is the correct
  outcome — a publish that quietly did not happen looks exactly like one that
  did. Nothing here has ever published successfully; this ADR records a
  decision, not a working deployment.
- Every published link now names `playdeck.video` and stays dead until that
  happens. `README.md` and `apps/storybook/README.md` are recoverable by a
  commit, but `packages/react/README.md` is the one that ships to npm, so the
  next release carries those URLs to consumers whether or not the domain
  answers by then.
- The artifact is verified locally rather than only in CI. `pnpm test:deploy`
  runs `scripts/check-deploy-artifact.mjs`, which builds both surfaces the way
  the workflow builds them — explicitly deleting `PLAYDECK_BASE_PATH` for the
  site so a stray shell value cannot make the harness build something the
  deploy never would — assembles them through `assembleDeploy`, serves the
  directory at an origin root with a miss answered as a 404 rather than as an
  index, and drives Chromium through both surfaces, following the site's
  internal links and clicking the workbench's own sidebar to a story. Every
  response, request failure, console error and page error is recorded for the
  whole visit and reported together. It is not a pull-request gate: it builds
  both surfaces from scratch and launches a browser, which is several times
  what `ci.yml` does per pull request.
- What the harness proves is the artifact, not the deployment. It serves the
  assembled directory from a local server that imitates the two behaviours the
  Worker's configuration pins — `not_found_handling: "none"` and the default
  `html_handling: "auto-trailing-slash"` — so a divergence between that
  imitation and Cloudflare's real behaviour is invisible to it, as is anything
  about DNS, certificates or the custom-domain route. Those are only ever
  proven by a run against the real origin, and no such run has happened.
- The deployment is a Worker that serves static assets and holds no script of
  this repository's, which is what `wrangler.jsonc`'s absent `main` and absent
  `assets.binding` say. That commits `apps/site` to a fully static build:
  `output: 'static'` in `astro.config.ts` is restated as a requirement rather
  than a preference, because a route that quietly became server-rendered would
  deploy broken.
- Publishing stays on `main` and on `workflow_dispatch` only. `ci.yml` builds
  both surfaces on every pull request, which is the part a pull request needs;
  what no pull-request gate does is assemble the artifact and serve it, so a
  failure that appears only once the two builds share one origin appears first
  in the deploy, after merge.
- The assembled directory is a new build output in the tree, so `deploy-dist/`
  is gitignored and excluded from lint — it is a copy of two outputs that were
  already excluded under the names they were built as, and linting it would
  lint minified bundles twice.
