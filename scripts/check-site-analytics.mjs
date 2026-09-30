#!/usr/bin/env node
// Checks the emitted document, because the environment flag is valuable only
// if it reaches the HTML a reader receives. It deliberately builds nothing:
// CI and the deployment workflow run it immediately after their existing site
// build, so both tracking modes are gated without making either job slower.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const document = await readFile(
  join(repoRoot, 'apps', 'site', 'dist', 'index.html'),
  'utf8'
);
const script =
  '<script defer data-domain="playdeck.video" src="https://analytics.pedrosousa.me/js/script.js"></script>';
const trackingEnabled = process.env.PUBLIC_PLAUSIBLE_ANALYTICS === 'true';

if (trackingEnabled && !document.includes(script)) {
  throw new Error(
    'The production site build does not contain the configured Plausible script.'
  );
}

if (!trackingEnabled && document.includes('analytics.pedrosousa.me')) {
  throw new Error('A non-production site build contains the Plausible script.');
}
