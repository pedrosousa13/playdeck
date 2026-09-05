// The curated data `scripts/compare-features.mjs` renders into
// docs/comparison/features.md -- issue #638's answer to "features cannot come
// out of a bundler the way #543's bytes can". `docs/comparison/method.md`'s
// "Features" section is the prose half of this: how the axis list below was
// built (the union of what each of the five libraries advertises about
// itself, never Playdeck's own feature list), which axes were tried and
// dropped and why, and what each alternative has that Playdeck does not, and
// the reverse.
//
// Every cell here is a claim, and every claim carries an `anchor` the
// generator re-evaluates against the actually-installed package on every run
// -- see that script's header for the five anchor kinds. This file supplies
// the claims; it does not check them.
//
// A few conventions the generator does not enforce, because they are about
// what to write rather than how to check it:
//
// - `status: 'no'` is never written without a checked `source` naming what
//   was read to conclude the feature is absent -- "no export found" on its
//   own is exactly the impression this issue rules out.
// - `status: 'plugin'` names the plugin in `note`, and only for a plugin that
//   is itself documented (its own README, its own docs page, or the
//   library's own docs naming it) -- never a guess at what probably exists.
// - No cell characterises another project's authors, intentions or quality.
//   Where an alternative's own docs frame a gap as a deliberate choice, the
//   note says "by design per <source>" rather than "lacks".
// - Playdeck's own cells follow the identical rule and carry no adjective the
//   other four rows do not: a headless library with fewer built-in UI parts
//   is not "worse" here, it is a different row with the same anchor
//   discipline as every other one.

/**
 * @typedef {{ kind: 'export'; module: string; name: string }} ExportAnchor
 * @typedef {{ kind: 'file' | 'types'; module: string; path: string; includes: string }} FileAnchor
 * @typedef {{ kind: 'package'; module: string; field: string }} PackageAnchor
 * @typedef {{ kind: 'absent'; module: string; name: string; path: string } | { kind: 'absent'; module: string; field: string }} AbsentAnchor
 * @typedef {ExportAnchor | FileAnchor | PackageAnchor | AbsentAnchor} Anchor
 * @typedef {{ status: 'yes' | 'partial' | 'no' | 'plugin'; anchor: Anchor; source: string; note?: string }} Cell
 * @typedef {{ id: string; label: string; entries: Record<string, Cell> }} Axis
 */

const REACT_PLAYER_README =
  'react-player 3.4.0, node_modules/react-player/README.md (installed package)';
const REACT_PLAYER_TYPES =
  'react-player 3.4.0, node_modules/react-player/dist/types.d.ts (installed package)';
const VIDSTACK_DOCS = '[vidstack.io](https://vidstack.io)';
const VIDSTACK_TYPES =
  '@vidstack/react 1.15.6, node_modules/@vidstack/react/index.d.ts (installed package)';
const MEDIA_CHROME_README =
  'media-chrome 4.19.2, node_modules/media-chrome/README.md (installed package)';
const MEDIA_CHROME_ELEMENTS_DOCS =
  '[media-chrome.org/docs/en/media-element](https://www.media-chrome.org/docs/en/media-element#compatible-media-elements)';
const VIDEOJS_DIST =
  'video.js 8.24.0, node_modules/video.js/dist/video.es.js (installed package)';
const PLAYDECK_REACT_README = 'packages/react/README.md';
const PLAYDECK_CONTEXT = "CONTEXT.md, the 'Availability' entry";
const PLAYDECK_DASH_DOC = '.out-of-scope/dash.md';

/** @type {readonly Axis[]} */
export const axes = [
  {
    id: 'capability-honesty',
    label: 'Capability honesty (unavailable vs. not-yet-known, with a reason)',
    entries: {
      Playdeck: {
        status: 'yes',
        anchor: {
          kind: 'types',
          module: '@playdeck/core',
          path: 'dist/types.d.ts',
          includes: 'export type PlayerCapabilities = {'
        },
        source: PLAYDECK_CONTEXT
      },
      'react-player': {
        status: 'no',
        anchor: {
          kind: 'absent',
          module: 'react-player',
          name: 'Availability',
          path: 'dist/types.d.ts'
        },
        source: REACT_PLAYER_TYPES,
        note: 'Capabilities surface as plain booleans and callback props (`pip`, `onError`), with no reasoned unavailable/unknown distinction.'
      },
      Vidstack: {
        status: 'no',
        anchor: {
          kind: 'absent',
          module: '@vidstack/react',
          name: 'Availability',
          path: 'index.d.ts'
        },
        source: VIDSTACK_TYPES,
        note: 'Support is read off booleans and events (`canGoogleCastSrc`, provider `canPlay`) with no reasoned unknown/unavailable union.'
      },
      'Media Chrome': {
        status: 'no',
        anchor: {
          kind: 'absent',
          module: 'media-chrome',
          name: 'Availability',
          path: 'dist/index.d.ts'
        },
        source:
          'media-chrome 4.19.2, node_modules/media-chrome/dist/index.d.ts',
        note: 'A control renders disabled or hidden by its own CSS attribute selectors; nothing reports why a command is unavailable.'
      },
      'Video.js': {
        status: 'no',
        anchor: {
          kind: 'absent',
          module: 'video.js',
          name: 'Availability',
          path: 'dist/types/video.d.ts'
        },
        source: 'video.js 8.24.0, node_modules/video.js/dist/types/video.d.ts',
        note: 'Components hide themselves (`hide()`/`show()`) with no published reason.'
      }
    }
  },
  {
    id: 'captions',
    label: 'Captions / text tracks',
    entries: {
      Playdeck: {
        status: 'yes',
        anchor: {
          kind: 'export',
          module: '@playdeck/react',
          name: 'CaptionsButton'
        },
        source: PLAYDECK_REACT_README
      },
      'react-player': {
        status: 'partial',
        anchor: {
          kind: 'file',
          module: 'react-player',
          path: 'README.md',
          includes: 'kind="subtitles"'
        },
        source: REACT_PLAYER_README,
        note: "Captions render only through a native `<track>` child and the browser's own control UI; react-player draws no captions button itself."
      },
      Vidstack: {
        status: 'yes',
        anchor: {
          kind: 'export',
          module: '@vidstack/react',
          name: 'CaptionButton'
        },
        source: VIDSTACK_DOCS
      },
      'Media Chrome': {
        status: 'yes',
        anchor: {
          kind: 'export',
          module: 'media-chrome/react',
          name: 'MediaCaptionsButton'
        },
        source: MEDIA_CHROME_README
      },
      'Video.js': {
        status: 'yes',
        anchor: {
          kind: 'file',
          module: 'video.js',
          path: 'dist/video.es.js',
          includes: "registerComponent('CaptionsButton'"
        },
        source: VIDEOJS_DIST
      }
    }
  },
  {
    id: 'quality-selection',
    label: 'Quality selection',
    entries: {
      Playdeck: {
        status: 'partial',
        anchor: {
          kind: 'types',
          module: '@playdeck/core',
          path: 'dist/types.d.ts',
          includes: 'readonly selectQuality: Availability;'
        },
        source:
          'packages/core/dist/types.d.ts (`PlayerCommand`, `PlayerCapabilities.selectQuality`)',
        note: 'A `selectQuality` command and `PlayerQuality`/`qualities` state exist; no dedicated quality button or menu primitive ships, a consumer composes one from `SettingsMenu`.'
      },
      'react-player': {
        status: 'no',
        anchor: {
          kind: 'absent',
          module: 'react-player',
          name: 'Quality',
          path: 'dist/types.d.ts'
        },
        source: REACT_PLAYER_TYPES
      },
      Vidstack: {
        status: 'yes',
        anchor: {
          kind: 'export',
          module: '@vidstack/react',
          name: 'useVideoQualityOptions'
        },
        source: VIDSTACK_DOCS
      },
      'Media Chrome': {
        status: 'yes',
        anchor: {
          kind: 'export',
          module: 'media-chrome/react/menu',
          name: 'MediaRenditionMenu'
        },
        source: MEDIA_CHROME_README
      },
      'Video.js': {
        status: 'partial',
        anchor: {
          kind: 'file',
          module: 'video.js',
          path: 'dist/video.es.js',
          includes: "videojs.registerPlugin('qualityLevels'"
        },
        source: VIDEOJS_DIST,
        note: 'The `qualityLevels()` API and `QualityLevelList` ship in core with no default UI button; the documented UI plugin is `videojs-http-source-selector`.'
      }
    }
  },
  {
    id: 'playback-rate',
    label: 'Playback rate',
    entries: {
      Playdeck: {
        status: 'partial',
        anchor: {
          kind: 'types',
          module: '@playdeck/core',
          path: 'dist/types.d.ts',
          includes: 'readonly setPlaybackRate: Availability;'
        },
        source:
          'packages/core/dist/types.d.ts (`PlayerCommand`, `PlayerCapabilities.setPlaybackRate`)',
        note: 'A `setPlaybackRate` command and capability exist; no dedicated playback-rate button or menu primitive ships.'
      },
      'react-player': {
        status: 'partial',
        anchor: {
          kind: 'types',
          module: 'react-player',
          path: 'dist/types.d.ts',
          includes: 'playbackRate?: number;'
        },
        source: REACT_PLAYER_README,
        note: 'By react-player\'s own README: "Only supported by YouTube, Wistia, and file paths" (not Vimeo, Mux, Twitch, TikTok or Spotify).'
      },
      Vidstack: {
        status: 'yes',
        anchor: {
          kind: 'export',
          module: '@vidstack/react',
          name: 'usePlaybackRateOptions'
        },
        source: VIDSTACK_DOCS
      },
      'Media Chrome': {
        status: 'yes',
        anchor: {
          kind: 'export',
          module: 'media-chrome/react',
          name: 'MediaPlaybackRateButton'
        },
        source: MEDIA_CHROME_README
      },
      'Video.js': {
        status: 'yes',
        anchor: {
          kind: 'file',
          module: 'video.js',
          path: 'dist/video.es.js',
          includes: "registerComponent('PlaybackRateMenuButton'"
        },
        source: VIDEOJS_DIST
      }
    }
  },
  {
    id: 'picture-in-picture',
    label: 'Picture-in-picture',
    entries: {
      Playdeck: {
        status: 'yes',
        anchor: {
          kind: 'export',
          module: '@playdeck/react',
          name: 'PipButton'
        },
        source: PLAYDECK_REACT_README
      },
      'react-player': {
        status: 'partial',
        anchor: {
          kind: 'types',
          module: 'react-player',
          path: 'dist/types.d.ts',
          includes: 'pip?: boolean;'
        },
        source: REACT_PLAYER_README,
        note: 'By react-player\'s own README: "Only available when playing file URLs in certain browsers" (not YouTube, Vimeo, Wistia or the other lazy-loaded providers).'
      },
      Vidstack: {
        status: 'yes',
        anchor: {
          kind: 'export',
          module: '@vidstack/react',
          name: 'PIPButton'
        },
        source: VIDSTACK_DOCS
      },
      'Media Chrome': {
        status: 'yes',
        anchor: {
          kind: 'export',
          module: 'media-chrome/react',
          name: 'MediaPipButton'
        },
        source: MEDIA_CHROME_README
      },
      'Video.js': {
        status: 'yes',
        anchor: {
          kind: 'file',
          module: 'video.js',
          path: 'dist/video.es.js',
          includes: "registerComponent('PictureInPictureToggle'"
        },
        source: VIDEOJS_DIST
      }
    }
  },
  {
    id: 'fullscreen',
    label: 'Fullscreen',
    entries: {
      Playdeck: {
        status: 'yes',
        anchor: {
          kind: 'export',
          module: '@playdeck/react',
          name: 'FullscreenButton'
        },
        source: PLAYDECK_REACT_README
      },
      'react-player': {
        status: 'no',
        anchor: {
          kind: 'absent',
          module: 'react-player',
          name: 'fullscreen',
          path: 'dist/ReactPlayer.js'
        },
        source:
          'react-player 3.4.0, node_modules/react-player/dist/ReactPlayer.js and dist/types.d.ts',
        note: 'No fullscreen prop or method of its own; a fullscreen button appears only when the native `<video controls>` or an iframe provider (YouTube, Vimeo) supplies one.'
      },
      Vidstack: {
        status: 'yes',
        anchor: {
          kind: 'export',
          module: '@vidstack/react',
          name: 'FullscreenButton'
        },
        source: VIDSTACK_DOCS
      },
      'Media Chrome': {
        status: 'yes',
        anchor: {
          kind: 'export',
          module: 'media-chrome/react',
          name: 'MediaFullscreenButton'
        },
        source: MEDIA_CHROME_README
      },
      'Video.js': {
        status: 'yes',
        anchor: {
          kind: 'file',
          module: 'video.js',
          path: 'dist/video.es.js',
          includes: "registerComponent('FullscreenToggle'"
        },
        source: VIDEOJS_DIST
      }
    }
  },
  {
    id: 'airplay',
    label: 'AirPlay',
    entries: {
      Playdeck: {
        status: 'yes',
        anchor: {
          kind: 'export',
          module: '@playdeck/react',
          name: 'AirPlayButton'
        },
        source: PLAYDECK_REACT_README
      },
      'react-player': {
        status: 'no',
        anchor: {
          kind: 'absent',
          module: 'react-player',
          name: 'irplay',
          path: 'dist/types.d.ts'
        },
        source: REACT_PLAYER_TYPES,
        note: "Ships `disableRemotePlayback` (opts out of the browser's own remote-playback picker) but no AirPlay-specific API of its own."
      },
      Vidstack: {
        status: 'yes',
        anchor: {
          kind: 'export',
          module: '@vidstack/react',
          name: 'AirPlayButton'
        },
        source: VIDSTACK_DOCS
      },
      'Media Chrome': {
        status: 'yes',
        anchor: {
          kind: 'export',
          module: 'media-chrome/react',
          name: 'MediaAirplayButton'
        },
        source: MEDIA_CHROME_README
      },
      'Video.js': {
        status: 'plugin',
        anchor: {
          kind: 'absent',
          module: 'video.js',
          name: "registerComponent('Airplay",
          path: 'dist/video.es.js'
        },
        source:
          '[npmjs.com/package/videojs-airplay](https://registry.npmjs.org/videojs-airplay)',
        note: 'Documented community plugin `videojs-airplay`; no AirPlay button in core.'
      }
    }
  },
  {
    id: 'chromecast',
    label: 'Chromecast / Google Cast',
    entries: {
      Playdeck: {
        status: 'no',
        anchor: {
          kind: 'absent',
          module: '@playdeck/core',
          name: 'ast',
          path: 'dist/types.d.ts'
        },
        source: PLAYDECK_DASH_DOC
      },
      'react-player': {
        status: 'no',
        anchor: {
          kind: 'absent',
          module: 'react-player',
          name: 'ast',
          path: 'dist/types.d.ts'
        },
        source: REACT_PLAYER_TYPES
      },
      Vidstack: {
        status: 'yes',
        anchor: {
          kind: 'export',
          module: '@vidstack/react',
          name: 'GoogleCastButton'
        },
        source: VIDSTACK_DOCS
      },
      'Media Chrome': {
        status: 'yes',
        anchor: {
          kind: 'export',
          module: 'media-chrome/react',
          name: 'MediaCastButton'
        },
        source: MEDIA_CHROME_README
      },
      'Video.js': {
        status: 'plugin',
        anchor: {
          kind: 'absent',
          module: 'video.js',
          name: "registerComponent('Chromecast",
          path: 'dist/video.es.js'
        },
        source:
          '[registry.npmjs.org/videojs-chromecast](https://registry.npmjs.org/videojs-chromecast)',
        note: 'Documented community plugin `videojs-chromecast`; core only detects a Chromecast _receiver_ context (`IS_CHROMECAST_RECEIVER`), which is not a sender button.'
      }
    }
  },
  {
    id: 'keyboard-operation',
    label: 'Keyboard operation',
    entries: {
      Playdeck: {
        status: 'yes',
        anchor: { kind: 'export', module: '@playdeck/react', name: 'Controls' },
        source: `${PLAYDECK_REACT_README} ("Controls is a focusable region that owns the media keyboard shortcuts")`
      },
      'react-player': {
        status: 'no',
        anchor: {
          kind: 'absent',
          module: 'react-player',
          name: 'onKeyDown',
          path: 'dist/HtmlPlayer.js'
        },
        source:
          'react-player 3.4.0, node_modules/react-player/dist/HtmlPlayer.js and dist/ReactPlayer.js',
        note: "No keyboard handling of its own; keyboard operation comes entirely from the native `<video controls>` or an iframe provider's own player."
      },
      Vidstack: {
        status: 'yes',
        anchor: {
          kind: 'export',
          module: '@vidstack/react',
          name: 'MEDIA_KEY_SHORTCUTS'
        },
        source: VIDSTACK_DOCS
      },
      'Media Chrome': {
        status: 'yes',
        anchor: {
          kind: 'export',
          module: 'media-chrome/react',
          name: 'MediaKeyboardShortcutsDialog'
        },
        source: MEDIA_CHROME_README
      },
      'Video.js': {
        status: 'yes',
        anchor: {
          kind: 'file',
          module: 'video.js',
          path: 'dist/video.es.js',
          includes: "'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'"
        },
        source: VIDEOJS_DIST
      }
    }
  },
  {
    id: 'screen-reader-labelling',
    label: 'Screen-reader labelling',
    entries: {
      Playdeck: {
        status: 'yes',
        anchor: {
          kind: 'file',
          module: '@playdeck/react',
          path: 'dist/index.js',
          includes: 'aria-label'
        },
        source: `${PLAYDECK_REACT_README} ("WCAG 2.1.4 Character Key Shortcuts requires...")`
      },
      'react-player': {
        status: 'partial',
        anchor: {
          kind: 'types',
          module: 'react-player',
          path: 'dist/types.d.ts',
          includes: 'previewAriaLabel?: string;'
        },
        source: REACT_PLAYER_TYPES,
        note: 'Only the `light`-mode preview button carries an authored `previewAriaLabel`; the native control set otherwise supplies its own accessible names.'
      },
      Vidstack: {
        status: 'yes',
        anchor: {
          kind: 'file',
          module: '@vidstack/react',
          path: 'prod/player/vidstack-default-components.js',
          includes: 'aria-label'
        },
        source: VIDSTACK_DOCS
      },
      'Media Chrome': {
        status: 'yes',
        anchor: {
          kind: 'file',
          module: 'media-chrome',
          path: 'dist/media-play-button.js',
          includes: 'aria-label'
        },
        source: MEDIA_CHROME_README
      },
      'Video.js': {
        status: 'yes',
        anchor: {
          kind: 'file',
          module: 'video.js',
          path: 'dist/video.es.js',
          includes: 'controlText_'
        },
        source: VIDEOJS_DIST
      }
    }
  },
  {
    id: 'drm',
    label: 'DRM / EME',
    entries: {
      Playdeck: {
        status: 'no',
        anchor: {
          kind: 'absent',
          module: '@playdeck/core',
          name: 'requestMediaKeySystemAccess',
          path: 'dist/index.js'
        },
        source: PLAYDECK_DASH_DOC
      },
      'react-player': {
        status: 'no',
        anchor: {
          kind: 'absent',
          module: 'react-player',
          name: 'rotection',
          path: 'dist/types.d.ts'
        },
        source: REACT_PLAYER_TYPES
      },
      Vidstack: {
        status: 'no',
        anchor: {
          kind: 'absent',
          module: '@vidstack/react',
          name: 'keySystem',
          path: 'index.d.ts'
        },
        source: VIDSTACK_TYPES
      },
      'Media Chrome': {
        status: 'no',
        anchor: {
          kind: 'absent',
          module: 'media-chrome',
          name: 'requestMediaKeySystemAccess',
          path: 'dist/index.d.ts'
        },
        source: 'media-chrome 4.19.2, node_modules/media-chrome/dist/index.d.ts'
      },
      'Video.js': {
        status: 'plugin',
        anchor: {
          kind: 'absent',
          module: 'video.js',
          name: 'requestMediaKeySystemAccess',
          path: 'dist/video.es.js'
        },
        source:
          '[npmjs.com/package/videojs-contrib-eme](https://registry.npmjs.org/videojs-contrib-eme)',
        note: 'Official videojs-org plugin `videojs-contrib-eme`; core has no EME call of its own.'
      }
    }
  },
  {
    id: 'hls',
    label: 'HLS',
    entries: {
      Playdeck: {
        status: 'yes',
        anchor: {
          kind: 'types',
          module: '@playdeck/core',
          path: 'dist/types.d.ts',
          includes: 'HlsSource'
        },
        source:
          'packages/core/dist/types.d.ts (`PlayerSource`); packages/provider-hls'
      },
      'react-player': {
        status: 'yes',
        anchor: {
          kind: 'file',
          module: 'react-player',
          path: 'dist/players.js',
          includes: 'canPlay: canPlay.hls'
        },
        source:
          'react-player 3.4.0, node_modules/react-player/dist/players.js (lazy `hls-video-element`)'
      },
      Vidstack: {
        status: 'yes',
        anchor: {
          kind: 'export',
          module: '@vidstack/react',
          name: 'HLSProviderLoader'
        },
        source: VIDSTACK_DOCS
      },
      'Media Chrome': {
        status: 'plugin',
        anchor: {
          kind: 'absent',
          module: 'media-chrome',
          name: 'hls',
          path: 'dist/index.d.ts'
        },
        source: MEDIA_CHROME_ELEMENTS_DOCS,
        note: 'No provider module of its own; the documented compatible element is `<hls-video>` (`hls-video-element`).'
      },
      'Video.js': {
        status: 'yes',
        anchor: {
          kind: 'file',
          module: 'video.js',
          path: 'dist/video.es.js',
          includes: 'videojs-http-streaming'
        },
        source: VIDEOJS_DIST
      }
    }
  },
  {
    id: 'dash',
    label: 'DASH',
    entries: {
      Playdeck: {
        status: 'no',
        anchor: {
          kind: 'types',
          module: '@playdeck/core',
          path: 'dist/types.d.ts',
          includes:
            'export type PlayerSource = string | VideoFileSource | HlsSource | YouTubeSource | VimeoSource | WistiaSource;'
        },
        source: PLAYDECK_DASH_DOC
      },
      'react-player': {
        status: 'yes',
        anchor: {
          kind: 'file',
          module: 'react-player',
          path: 'dist/players.js',
          includes: 'canPlay: canPlay.dash'
        },
        source:
          'react-player 3.4.0, node_modules/react-player/dist/players.js (lazy `dash-video-element`)'
      },
      Vidstack: {
        status: 'yes',
        anchor: {
          kind: 'export',
          module: '@vidstack/react',
          name: 'DASHProviderLoader'
        },
        source: VIDSTACK_DOCS
      },
      'Media Chrome': {
        status: 'plugin',
        anchor: {
          kind: 'absent',
          module: 'media-chrome',
          name: 'dash',
          path: 'dist/index.d.ts'
        },
        source: MEDIA_CHROME_ELEMENTS_DOCS,
        note: 'The documented compatible element is `<dash-video>` (`dash-video-element`); see also `.out-of-scope/dash.md`.'
      },
      'Video.js': {
        status: 'yes',
        anchor: {
          kind: 'file',
          module: 'video.js',
          path: 'dist/video.es.js',
          includes: 'mpd-parser'
        },
        source: VIDEOJS_DIST
      }
    }
  },
  {
    id: 'live-streaming',
    label: 'Live streaming',
    entries: {
      Playdeck: {
        status: 'partial',
        anchor: {
          kind: 'export',
          module: '@playdeck/core',
          name: 'deriveLiveState'
        },
        source:
          'packages/core/dist/index.d.ts (`PlayerLiveState`, `deriveLiveState`)',
        note: 'Live playback state is modeled and existing controls adapt (an infinite/DVR duration); no dedicated live-indicator UI primitive ships.'
      },
      'react-player': {
        status: 'no',
        anchor: {
          kind: 'absent',
          module: 'react-player',
          name: 'ive',
          path: 'dist/types.d.ts'
        },
        source: REACT_PLAYER_TYPES
      },
      Vidstack: {
        status: 'yes',
        anchor: {
          kind: 'export',
          module: '@vidstack/react',
          name: 'LiveButton'
        },
        source: VIDSTACK_DOCS
      },
      'Media Chrome': {
        status: 'yes',
        anchor: {
          kind: 'export',
          module: 'media-chrome/react',
          name: 'MediaLiveButton'
        },
        source: MEDIA_CHROME_README
      },
      'Video.js': {
        status: 'yes',
        anchor: {
          kind: 'file',
          module: 'video.js',
          path: 'dist/video.es.js',
          includes: 'seekToLive'
        },
        source: VIDEOJS_DIST
      }
    }
  },
  {
    id: 'youtube',
    label: 'YouTube',
    entries: {
      Playdeck: {
        status: 'yes',
        anchor: {
          kind: 'types',
          module: '@playdeck/core',
          path: 'dist/types.d.ts',
          includes: 'YouTubeSource'
        },
        source:
          'packages/core/dist/types.d.ts (`PlayerSource`); packages/provider-youtube'
      },
      'react-player': {
        status: 'yes',
        anchor: {
          kind: 'file',
          module: 'react-player',
          path: 'dist/players.js',
          includes: 'canPlay: canPlay.youtube'
        },
        source:
          'react-player 3.4.0, node_modules/react-player/dist/players.js (lazy `youtube-video-element`)'
      },
      Vidstack: {
        status: 'yes',
        anchor: {
          kind: 'export',
          module: '@vidstack/react',
          name: 'YouTubeProviderLoader'
        },
        source: VIDSTACK_DOCS
      },
      'Media Chrome': {
        status: 'plugin',
        anchor: {
          kind: 'absent',
          module: 'media-chrome',
          name: 'youtube',
          path: 'dist/index.d.ts'
        },
        source: MEDIA_CHROME_ELEMENTS_DOCS,
        note: 'No provider module of its own; the documented compatible element is `<youtube-video>` (`youtube-video-element`).'
      },
      'Video.js': {
        status: 'plugin',
        anchor: {
          kind: 'absent',
          module: 'video.js',
          name: 'youtube',
          path: 'dist/video.es.js'
        },
        source:
          '[registry.npmjs.org/videojs-youtube](https://registry.npmjs.org/videojs-youtube)',
        note: 'Documented community tech plugin `videojs-youtube`; no YouTube tech in core.'
      }
    }
  },
  {
    id: 'vimeo',
    label: 'Vimeo',
    entries: {
      Playdeck: {
        status: 'yes',
        anchor: {
          kind: 'types',
          module: '@playdeck/core',
          path: 'dist/types.d.ts',
          includes: 'VimeoSource'
        },
        source:
          'packages/core/dist/types.d.ts (`PlayerSource`); packages/provider-vimeo'
      },
      'react-player': {
        status: 'yes',
        anchor: {
          kind: 'file',
          module: 'react-player',
          path: 'dist/players.js',
          includes: 'canPlay: canPlay.vimeo'
        },
        source:
          'react-player 3.4.0, node_modules/react-player/dist/players.js (lazy `vimeo-video-element`)'
      },
      Vidstack: {
        status: 'yes',
        anchor: {
          kind: 'export',
          module: '@vidstack/react',
          name: 'VimeoProviderLoader'
        },
        source: VIDSTACK_DOCS
      },
      'Media Chrome': {
        status: 'plugin',
        anchor: {
          kind: 'absent',
          module: 'media-chrome',
          name: 'vimeo',
          path: 'dist/index.d.ts'
        },
        source: MEDIA_CHROME_ELEMENTS_DOCS,
        note: 'No provider module of its own; the documented compatible element is `<vimeo-video>` (`vimeo-video-element`).'
      },
      'Video.js': {
        status: 'plugin',
        anchor: {
          kind: 'absent',
          module: 'video.js',
          name: 'vimeo',
          path: 'dist/video.es.js'
        },
        source:
          '[registry.npmjs.org/videojs-vimeo](https://registry.npmjs.org/videojs-vimeo)',
        note: 'Documented community tech plugin `videojs-vimeo`; no Vimeo tech in core.'
      }
    }
  },
  {
    id: 'wistia',
    label: 'Wistia',
    entries: {
      Playdeck: {
        status: 'yes',
        anchor: {
          kind: 'types',
          module: '@playdeck/core',
          path: 'dist/types.d.ts',
          includes: 'WistiaSource'
        },
        source:
          'packages/core/dist/types.d.ts (`PlayerSource`); packages/provider-wistia'
      },
      'react-player': {
        status: 'yes',
        anchor: {
          kind: 'file',
          module: 'react-player',
          path: 'dist/players.js',
          includes: 'canPlay: canPlay.wistia'
        },
        source: 'react-player 3.4.0, node_modules/react-player/dist/players.js'
      },
      Vidstack: {
        status: 'no',
        anchor: {
          kind: 'absent',
          module: '@vidstack/react',
          name: 'Wistia',
          path: 'index.d.ts'
        },
        source: VIDSTACK_TYPES
      },
      'Media Chrome': {
        status: 'plugin',
        anchor: {
          kind: 'absent',
          module: 'media-chrome',
          name: 'wistia',
          path: 'dist/index.d.ts'
        },
        source: MEDIA_CHROME_ELEMENTS_DOCS,
        note: 'No provider module of its own; the documented compatible element is `<wistia-video>` (`wistia-video-element`).'
      },
      'Video.js': {
        status: 'no',
        anchor: {
          kind: 'absent',
          module: 'video.js',
          name: 'istia',
          path: 'dist/video.es.js'
        },
        source: VIDEOJS_DIST
      }
    }
  },
  {
    id: 'other-providers',
    label: 'Other hosted providers (named)',
    entries: {
      Playdeck: {
        status: 'no',
        anchor: {
          kind: 'types',
          module: '@playdeck/core',
          path: 'dist/types.d.ts',
          includes:
            'export type PlayerSource = string | VideoFileSource | HlsSource | YouTubeSource | VimeoSource | WistiaSource;'
        },
        source:
          'packages/core/dist/types.d.ts (`PlayerSource` is a closed union of exactly these five kinds)'
      },
      'react-player': {
        status: 'yes',
        anchor: {
          kind: 'types',
          module: 'react-player',
          path: 'dist/types.d.ts',
          includes: 'mux?: Record<string, unknown>;'
        },
        source: REACT_PLAYER_TYPES,
        note: 'Mux, Twitch, TikTok and Spotify each have their own `Config` key and a lazy-loaded provider.'
      },
      Vidstack: {
        status: 'no',
        anchor: {
          kind: 'absent',
          module: '@vidstack/react',
          name: 'TwitchProvider',
          path: 'index.d.ts'
        },
        source: VIDSTACK_TYPES,
        note: 'Providers beyond HLS/DASH/YouTube/Vimeo/audio/video are not hosted platforms (e.g. a Remotion render provider).'
      },
      'Media Chrome': {
        status: 'plugin',
        anchor: {
          kind: 'absent',
          module: 'media-chrome',
          name: 'cloudflare',
          path: 'dist/index.d.ts'
        },
        source: MEDIA_CHROME_ELEMENTS_DOCS,
        note: 'Documented compatible elements also include Cloudflare (`<cloudflare-video>`), JW Player, Mux, Shaka Player and Spotify.'
      },
      'Video.js': {
        status: 'no',
        anchor: {
          kind: 'absent',
          module: 'video.js',
          name: 'twitch',
          path: 'dist/video.es.js'
        },
        source: '[videojs.org/plugins](https://videojs.org/plugins)',
        note: 'No further hosted-provider tech is named on the official plugins page.'
      }
    }
  },
  {
    id: 'audio-tracks',
    label: 'Audio tracks',
    entries: {
      Playdeck: {
        status: 'no',
        anchor: {
          kind: 'absent',
          module: '@playdeck/core',
          name: 'AudioTrack',
          path: 'dist/types.d.ts'
        },
        source: 'packages/core/dist/types.d.ts'
      },
      'react-player': {
        status: 'no',
        anchor: {
          kind: 'absent',
          module: 'react-player',
          name: 'AudioTrack',
          path: 'dist/types.d.ts'
        },
        source: REACT_PLAYER_TYPES
      },
      Vidstack: {
        status: 'yes',
        anchor: {
          kind: 'export',
          module: '@vidstack/react',
          name: 'useAudioOptions'
        },
        source: VIDSTACK_DOCS
      },
      'Media Chrome': {
        status: 'yes',
        anchor: {
          kind: 'export',
          module: 'media-chrome/react/menu',
          name: 'MediaAudioTrackMenu'
        },
        source: MEDIA_CHROME_README
      },
      'Video.js': {
        status: 'yes',
        anchor: {
          kind: 'file',
          module: 'video.js',
          path: 'dist/video.es.js',
          includes: "registerComponent('AudioTrackButton'"
        },
        source: VIDEOJS_DIST
      }
    }
  },
  {
    id: 'chapters',
    label: 'Chapters',
    entries: {
      Playdeck: {
        status: 'partial',
        anchor: {
          kind: 'export',
          module: '@playdeck/core',
          name: 'deriveChapters'
        },
        source:
          "CONTEXT.md, the 'Chapter' entry; packages/core/dist/index.d.ts",
        note: 'A `Chapter` collection is published on player state; no chapters navigation UI primitive ships.'
      },
      'react-player': {
        status: 'no',
        anchor: {
          kind: 'absent',
          module: 'react-player',
          name: 'hapter',
          path: 'dist/types.d.ts'
        },
        source: REACT_PLAYER_TYPES
      },
      Vidstack: {
        status: 'yes',
        anchor: {
          kind: 'export',
          module: '@vidstack/react',
          name: 'useChapterOptions'
        },
        source: VIDSTACK_DOCS
      },
      'Media Chrome': {
        status: 'partial',
        anchor: {
          kind: 'export',
          module: 'media-chrome/react',
          name: 'MediaPreviewChapterDisplay'
        },
        source: MEDIA_CHROME_README,
        note: 'Shows the current chapter title while scrubbing; ships no chapters navigation menu.'
      },
      'Video.js': {
        status: 'yes',
        anchor: {
          kind: 'file',
          module: 'video.js',
          path: 'dist/video.es.js',
          includes: "registerComponent('ChaptersButton'"
        },
        source: VIDEOJS_DIST
      }
    }
  },
  {
    id: 'thumbnail-preview',
    label: 'Thumbnails / preview on seek',
    entries: {
      Playdeck: {
        status: 'no',
        anchor: {
          kind: 'absent',
          module: '@playdeck/react',
          name: 'humbnail',
          path: 'dist/index.d.ts'
        },
        source: PLAYDECK_REACT_README
      },
      'react-player': {
        status: 'no',
        anchor: {
          kind: 'absent',
          module: 'react-player',
          name: 'humbnail',
          path: 'dist/types.d.ts'
        },
        source: REACT_PLAYER_README,
        note: 'The `light` prop is a static startup poster, not a hover/scrub seek preview.'
      },
      Vidstack: {
        status: 'yes',
        anchor: {
          kind: 'export',
          module: '@vidstack/react',
          name: 'Thumbnail'
        },
        source: VIDSTACK_DOCS
      },
      'Media Chrome': {
        status: 'yes',
        anchor: {
          kind: 'export',
          module: 'media-chrome/react',
          name: 'MediaPreviewThumbnail'
        },
        source: MEDIA_CHROME_README
      },
      'Video.js': {
        status: 'plugin',
        anchor: {
          kind: 'absent',
          module: 'video.js',
          name: 'humbnail',
          path: 'dist/video.es.js'
        },
        source:
          '[registry.npmjs.org/videojs-sprite-thumbnails](https://registry.npmjs.org/videojs-sprite-thumbnails)',
        note: 'Documented community plugin `videojs-sprite-thumbnails`; no seek-preview thumbnail support in core.'
      }
    }
  },
  {
    id: 'playlists',
    label: 'Playlists',
    entries: {
      Playdeck: {
        status: 'no',
        anchor: {
          kind: 'absent',
          module: '@playdeck/core',
          name: 'laylist',
          path: 'dist/types.d.ts'
        },
        source:
          'packages/core/dist/types.d.ts (`Root` takes one `source`, not a list)'
      },
      'react-player': {
        status: 'no',
        anchor: {
          kind: 'absent',
          module: 'react-player',
          name: 'laylist',
          path: 'dist/types.d.ts'
        },
        source: REACT_PLAYER_TYPES
      },
      Vidstack: {
        status: 'no',
        anchor: {
          kind: 'absent',
          module: '@vidstack/react',
          name: 'Playlist',
          path: 'index.d.ts'
        },
        source: VIDSTACK_TYPES
      },
      'Media Chrome': {
        status: 'no',
        anchor: {
          kind: 'absent',
          module: 'media-chrome',
          name: 'laylist',
          path: 'dist/index.d.ts'
        },
        source: 'media-chrome 4.19.2, node_modules/media-chrome/dist/index.d.ts'
      },
      'Video.js': {
        status: 'plugin',
        anchor: {
          kind: 'absent',
          module: 'video.js',
          name: "registerComponent('Playlist",
          path: 'dist/video.es.js'
        },
        source:
          '[registry.npmjs.org/videojs-playlist](https://registry.npmjs.org/videojs-playlist)',
        note: 'Official Brightcove/videojs-org plugin `videojs-playlist`; no playlist concept in core.'
      }
    }
  },
  {
    id: 'ads',
    label: 'Ads / IMA',
    entries: {
      Playdeck: {
        status: 'no',
        anchor: {
          kind: 'absent',
          module: '@playdeck/core',
          name: 'PlayerCommand.*ad',
          path: 'dist/types.d.ts'
        },
        source: PLAYDECK_DASH_DOC
      },
      'react-player': {
        status: 'no',
        anchor: {
          kind: 'absent',
          module: 'react-player',
          name: 'AdBreak',
          path: 'dist/types.d.ts'
        },
        source: REACT_PLAYER_README
      },
      Vidstack: {
        status: 'no',
        anchor: {
          kind: 'absent',
          module: '@vidstack/react',
          name: 'AdsInstance',
          path: 'index.d.ts'
        },
        source: VIDSTACK_TYPES
      },
      'Media Chrome': {
        status: 'no',
        anchor: {
          kind: 'absent',
          module: 'media-chrome',
          name: 'AdOverlay',
          path: 'dist/index.d.ts'
        },
        source: 'media-chrome 4.19.2, node_modules/media-chrome/dist/index.d.ts'
      },
      'Video.js': {
        status: 'plugin',
        anchor: {
          kind: 'absent',
          module: 'video.js',
          name: 'AdsInstance',
          path: 'dist/video.es.js'
        },
        source:
          '[registry.npmjs.org/videojs-contrib-ads](https://registry.npmjs.org/videojs-contrib-ads)',
        note: "Official videojs-org ad-timeline framework `videojs-contrib-ads` (paired with Google's `videojs-ima`); no ad support in core."
      }
    }
  },
  {
    id: 'analytics',
    label: 'Analytics hooks',
    entries: {
      Playdeck: {
        status: 'no',
        anchor: {
          kind: 'absent',
          module: '@playdeck/core',
          name: 'nalytics',
          path: 'dist/index.d.ts'
        },
        source: PLAYDECK_DASH_DOC,
        note: 'Playback events exist for a consumer to wire up; no dedicated analytics-reporting adapter ships.'
      },
      'react-player': {
        status: 'no',
        anchor: {
          kind: 'absent',
          module: 'react-player',
          name: 'nalytics',
          path: 'README.md'
        },
        source: REACT_PLAYER_README
      },
      Vidstack: {
        status: 'no',
        anchor: {
          kind: 'absent',
          module: '@vidstack/react',
          name: 'Analytics',
          path: 'index.d.ts'
        },
        source: VIDSTACK_TYPES
      },
      'Media Chrome': {
        status: 'no',
        anchor: {
          kind: 'absent',
          module: 'media-chrome',
          name: 'nalytics',
          path: 'README.md'
        },
        source: MEDIA_CHROME_README
      },
      'Video.js': {
        status: 'no',
        anchor: {
          kind: 'absent',
          module: 'video.js',
          name: 'nalytics',
          path: 'dist/video.es.js'
        },
        source: VIDEOJS_DIST
      }
    }
  },
  {
    id: 'plugin-system',
    label: 'Plugin system',
    entries: {
      Playdeck: {
        status: 'no',
        anchor: {
          kind: 'absent',
          module: '@playdeck/react',
          name: 'registerPlugin',
          path: 'dist/index.js'
        },
        source: PLAYDECK_REACT_README,
        note: 'Extensibility is React composition (compose primitives, pass props/render props), not a plugin registry.'
      },
      'react-player': {
        status: 'yes',
        anchor: {
          kind: 'export',
          module: 'react-player',
          name: 'default'
        },
        source: `${REACT_PLAYER_README} ("addCustomPlayer")`,
        note: '`ReactPlayer.addCustomPlayer` / `removeCustomPlayers` register a custom player implementation.'
      },
      Vidstack: {
        status: 'no',
        anchor: {
          kind: 'absent',
          module: '@vidstack/react',
          name: 'Plugin',
          path: 'index.d.ts'
        },
        source: VIDSTACK_TYPES
      },
      'Media Chrome': {
        status: 'no',
        anchor: {
          kind: 'absent',
          module: 'media-chrome',
          name: 'lugin',
          path: 'README.md'
        },
        source: MEDIA_CHROME_README,
        note: 'Extensibility is authoring another custom element, not a plugin registry.'
      },
      'Video.js': {
        status: 'yes',
        anchor: {
          kind: 'file',
          module: 'video.js',
          path: 'dist/video.es.js',
          includes: 'static registerPlugin(name, plugin)'
        },
        source: VIDEOJS_DIST
      }
    }
  },
  {
    id: 'shipped-skin',
    label: 'Shipped skin / theme',
    entries: {
      Playdeck: {
        status: 'yes',
        anchor: {
          kind: 'file',
          module: '@playdeck/react',
          path: 'package.json',
          includes: '"./theme.css": "./theme.css"'
        },
        source: PLAYDECK_REACT_README,
        note: 'Opt-in: `theme.css`/`docked.css` are never imported by the primitives themselves (see "required stylesheet" below).'
      },
      'react-player': {
        status: 'no',
        anchor: {
          kind: 'absent',
          module: 'react-player',
          field: 'style'
        },
        source: 'react-player 3.4.0, node_modules/react-player/package.json',
        note: "Ships no CSS file; visible controls are always the native `<video>` chrome or an iframe provider's own UI."
      },
      Vidstack: {
        status: 'yes',
        anchor: {
          kind: 'export',
          module: '@vidstack/react/player/layouts/default',
          name: 'DefaultVideoLayout'
        },
        source: VIDSTACK_DOCS
      },
      'Media Chrome': {
        status: 'no',
        anchor: {
          kind: 'absent',
          module: 'media-chrome',
          field: 'style'
        },
        source: 'media-chrome 4.19.2, node_modules/media-chrome/package.json',
        note: 'Ships a theming _engine_ (`MediaThemeElement`) for building a skin, not a pre-built default one.'
      },
      'Video.js': {
        status: 'yes',
        anchor: { kind: 'package', module: 'video.js', field: 'style' },
        source: 'video.js 8.24.0, node_modules/video.js/package.json'
      }
    }
  },
  {
    id: 'headless-parts',
    label: 'Headless, independently composable parts',
    entries: {
      Playdeck: {
        status: 'yes',
        anchor: {
          kind: 'export',
          module: '@playdeck/react',
          name: 'PlayButton'
        },
        source: PLAYDECK_REACT_README
      },
      'react-player': {
        status: 'no',
        anchor: {
          kind: 'absent',
          module: 'react-player',
          name: 'PlayButton',
          path: 'dist/index.d.ts'
        },
        source: REACT_PLAYER_TYPES,
        note: "One configured component; controls are either the native chrome or an iframe provider's own UI, not independently importable parts."
      },
      Vidstack: {
        status: 'yes',
        anchor: {
          kind: 'export',
          module: '@vidstack/react',
          name: 'PlayButton'
        },
        source: VIDSTACK_DOCS
      },
      'Media Chrome': {
        status: 'yes',
        anchor: {
          kind: 'export',
          module: 'media-chrome/react',
          name: 'MediaPlayButton'
        },
        source: MEDIA_CHROME_README
      },
      'Video.js': {
        status: 'no',
        anchor: {
          kind: 'absent',
          module: 'video.js',
          name: 'PlayButton',
          path: 'dist/types/video.d.ts'
        },
        source: 'video.js 8.24.0, node_modules/video.js/dist/types/video.d.ts',
        note: 'Internal components are reachable imperatively (`player.controlBar.getChild(...)`), not as independently importable React parts; no official React wrapper exists at all.'
      }
    }
  },
  {
    id: 'required-stylesheet',
    label: 'Requires an external stylesheet for usable controls',
    entries: {
      Playdeck: {
        status: 'no',
        anchor: { kind: 'absent', module: '@playdeck/react', field: 'style' },
        source: PLAYDECK_REACT_README
      },
      'react-player': {
        status: 'no',
        anchor: { kind: 'absent', module: 'react-player', field: 'style' },
        source: 'react-player 3.4.0, node_modules/react-player/package.json'
      },
      Vidstack: {
        status: 'yes',
        anchor: {
          kind: 'file',
          module: '@vidstack/react',
          path: 'player/styles/default/theme.css',
          includes: 'Player'
        },
        source: VIDSTACK_DOCS
      },
      'Media Chrome': {
        status: 'no',
        anchor: {
          kind: 'file',
          module: 'media-chrome',
          path: 'dist/media-chrome-button.js',
          includes: 'attachShadow'
        },
        source:
          'media-chrome 4.19.2, node_modules/media-chrome/dist/media-chrome-button.js',
        note: 'Each custom element ships its own Shadow DOM styles.'
      },
      'Video.js': {
        status: 'yes',
        anchor: { kind: 'package', module: 'video.js', field: 'style' },
        source: 'video.js 8.24.0, node_modules/video.js/package.json'
      }
    }
  },
  {
    id: 'lazy-provider-loading',
    label: 'Lazy / deferred provider loading',
    entries: {
      Playdeck: {
        status: 'yes',
        anchor: {
          kind: 'file',
          module: '@playdeck/react',
          path: 'dist/index.js',
          includes: 'import('
        },
        source: `${PLAYDECK_REACT_README} ("Provider packages are pulled in as dependencies but loaded lazily")`
      },
      'react-player': {
        status: 'yes',
        anchor: {
          kind: 'file',
          module: 'react-player',
          path: 'dist/players.js',
          includes: 'lazy('
        },
        source: REACT_PLAYER_README
      },
      Vidstack: {
        status: 'yes',
        anchor: {
          kind: 'file',
          module: '@vidstack/react',
          path: 'prod/vidstack.js',
          includes: 'import('
        },
        source: VIDSTACK_DOCS
      },
      'Media Chrome': {
        status: 'no',
        anchor: {
          kind: 'absent',
          module: 'media-chrome',
          name: 'import(',
          path: 'dist/index.js'
        },
        source: 'media-chrome 4.19.2, node_modules/media-chrome/dist/index.js',
        note: 'Nothing to defer: it ships no provider of its own to load.'
      },
      'Video.js': {
        status: 'no',
        anchor: {
          kind: 'absent',
          module: 'video.js',
          name: 'import(',
          path: 'dist/video.es.js'
        },
        source: VIDEOJS_DIST,
        note: 'The HLS/DASH engine (videojs-http-streaming, mpd-parser, m3u8-parser) is a static import with no dynamic boundary.'
      }
    }
  },
  {
    id: 'react-version',
    label: 'React version supported',
    entries: {
      Playdeck: {
        status: 'yes',
        anchor: {
          kind: 'package',
          module: '@playdeck/react',
          field: 'peerDependencies.react'
        },
        source: 'packages/react/package.json',
        note: '`>=19 <20` — React 19 only.'
      },
      'react-player': {
        status: 'yes',
        anchor: {
          kind: 'package',
          module: 'react-player',
          field: 'peerDependencies.react'
        },
        source: 'react-player 3.4.0, node_modules/react-player/package.json',
        note: '`^17.0.2 || ^18 || ^19`.'
      },
      Vidstack: {
        status: 'yes',
        anchor: {
          kind: 'package',
          module: '@vidstack/react',
          field: 'peerDependencies.react'
        },
        source:
          '@vidstack/react 1.15.6, node_modules/@vidstack/react/package.json',
        note: '`^18.0.0 || ^19.0.0`.'
      },
      'Media Chrome': {
        status: 'partial',
        anchor: {
          kind: 'absent',
          module: 'media-chrome',
          field: 'peerDependencies.react'
        },
        source: 'media-chrome 4.19.2, node_modules/media-chrome/package.json',
        note: 'No declared peer range; the React wrapper is generated at build time via `ce-la-react` (a runtime dependency), tested against React 19.2.2.'
      },
      'Video.js': {
        status: 'no',
        anchor: {
          kind: 'absent',
          module: 'video.js',
          field: 'peerDependencies'
        },
        source: 'video.js 8.24.0, node_modules/video.js/package.json',
        note: 'No React integration of any kind ships; a consumer hand-writes their own wrapper.'
      }
    }
  },
  {
    id: 'ssr',
    label: 'SSR support',
    entries: {
      Playdeck: {
        status: 'yes',
        anchor: {
          kind: 'file',
          module: '@playdeck/react',
          path: 'dist/index.js',
          includes: '"use client"'
        },
        source: `${PLAYDECK_REACT_README} (a React Server Component can import these primitives directly)`
      },
      'react-player': {
        status: 'yes',
        anchor: {
          kind: 'file',
          module: 'react-player',
          path: 'dist/index.js',
          includes: 'use client'
        },
        source: 'react-player 3.4.0, node_modules/react-player/dist/index.js'
      },
      Vidstack: {
        status: 'yes',
        anchor: {
          kind: 'file',
          module: '@vidstack/react',
          path: 'prod/vidstack.js',
          includes: 'use client'
        },
        source: VIDSTACK_DOCS,
        note: "Also ships a dedicated `server`/`worker` build condition (`server/vidstack.js`) alongside the `'use client'` entry."
      },
      'Media Chrome': {
        status: 'yes',
        anchor: {
          kind: 'file',
          module: 'media-chrome',
          path: 'dist/utils/server-safe-globals.js',
          includes: 'isServer'
        },
        source:
          'media-chrome 4.19.2, node_modules/media-chrome/dist/utils/server-safe-globals.js',
        note: "Renders as inert custom-element markup during SSR (guarded by `isServer`) without a `'use client'` boundary; behaviour attaches on hydration."
      },
      'Video.js': {
        status: 'no',
        anchor: {
          kind: 'absent',
          module: 'video.js',
          name: 'use client',
          path: 'dist/video.es.js'
        },
        source: VIDEOJS_DIST,
        note: 'No React integration to carry an SSR story at all.'
      }
    }
  },
  {
    id: 'typescript-types',
    label: 'TypeScript types shipped',
    entries: {
      Playdeck: {
        status: 'yes',
        anchor: {
          kind: 'file',
          module: '@playdeck/react',
          path: 'package.json',
          includes: '"types": "./dist/index.d.ts"'
        },
        source: 'packages/react/package.json'
      },
      'react-player': {
        status: 'yes',
        anchor: {
          kind: 'file',
          module: 'react-player',
          path: 'package.json',
          includes: '"types": "./dist/index.d.ts"'
        },
        source: 'react-player 3.4.0, node_modules/react-player/package.json'
      },
      Vidstack: {
        status: 'yes',
        anchor: { kind: 'package', module: '@vidstack/react', field: 'types' },
        source:
          '@vidstack/react 1.15.6, node_modules/@vidstack/react/package.json'
      },
      'Media Chrome': {
        status: 'yes',
        anchor: {
          kind: 'file',
          module: 'media-chrome',
          path: 'package.json',
          includes: '"types": "./dist/react/index.d.ts"'
        },
        source: 'media-chrome 4.19.2, node_modules/media-chrome/package.json'
      },
      'Video.js': {
        status: 'yes',
        anchor: { kind: 'package', module: 'video.js', field: 'types' },
        source: 'video.js 8.24.0, node_modules/video.js/package.json'
      }
    }
  },
  {
    id: 'esm-cjs',
    label: 'ESM/CJS (dual build)',
    entries: {
      Playdeck: {
        status: 'partial',
        anchor: {
          kind: 'file',
          module: '@playdeck/react',
          path: 'esm-only.cjs',
          includes: 'ESM only'
        },
        source: 'packages/react/esm-only.cjs',
        note: "By design: the `require` condition resolves to a stub that throws by name, refusing a CJS `require()` rather than leaving the failure to Node's own report."
      },
      'react-player': {
        status: 'partial',
        anchor: {
          kind: 'absent',
          module: 'react-player',
          name: '"require":',
          path: 'package.json'
        },
        source: 'react-player 3.4.0, node_modules/react-player/package.json',
        note: 'ESM-only (`"type": "module"`, no `require` export condition).'
      },
      Vidstack: {
        status: 'partial',
        anchor: {
          kind: 'absent',
          module: '@vidstack/react',
          name: '"require":',
          path: 'package.json'
        },
        source:
          '@vidstack/react 1.15.6, node_modules/@vidstack/react/package.json',
        note: 'ESM-only (`"type": "module"`, no `require` export condition).'
      },
      'Media Chrome': {
        status: 'yes',
        anchor: {
          kind: 'file',
          module: 'media-chrome',
          path: 'package.json',
          includes: '"require":'
        },
        source: 'media-chrome 4.19.2, node_modules/media-chrome/package.json'
      },
      'Video.js': {
        status: 'yes',
        anchor: { kind: 'package', module: 'video.js', field: 'main' },
        source: 'video.js 8.24.0, node_modules/video.js/package.json',
        note: '`main` (CJS, `dist/video.cjs.js`) and `module` (ESM, `dist/video.es.js`) are both published.'
      }
    }
  }
];
