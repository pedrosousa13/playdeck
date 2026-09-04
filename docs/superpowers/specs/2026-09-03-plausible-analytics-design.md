# Production Plausible analytics

## Goal

Track visits to `playdeck.video` through the self-hosted Plausible instance at
`analytics.pedrosousa.me`, without loading analytics in local or pull-request
builds.

## Design

The shared Astro base layout is the only document head in the site, so it owns
the integration. It will render the following external, deferred script only
when an explicit public build-time variable is present:

```html
<script
  defer
  data-domain="playdeck.video"
  src="https://analytics.pedrosousa.me/js/script.js"
></script>
```

The deployment workflow supplies the variable for its production build. Other
builds leave it unset and therefore emit no script, no analytics request, and
no tracking configuration. The variable contains no credential; the data domain
and script address must be visible in the deployed HTML.

## Verification

Build the site both with and without the variable. Assert that only the
production-configured artifact contains the exact deferred script with the
expected domain and source URL.
