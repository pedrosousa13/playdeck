// Imports only the pure poster helper -- nothing else from the package --
// which is the whole claim test.mjs checks: a consumer who wants a YouTube
// poster for a dormant `loading="interaction"` root should not pay for the
// iframe API loader or the attachment/boundary/playback machinery that comes
// with mounting a real player.
import { resolveYouTubePosterUrl } from '@playdeck/provider-youtube';

const poster = resolveYouTubePosterUrl(
  'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
);

document.title = poster ?? 'no-poster';
