// The curated data `scripts/compare-features.mjs` renders into
// docs/comparison/features.md -- issue #638's answer to "features cannot come
// out of a bundler the way #543's bytes can". `docs/comparison/method.md`'s
// "Features" section is the prose half of this: how the axis list below was
// built (the union of what each compared library advertises about itself,
// never Playdeck's own feature list), which axes were tried and dropped and
// why, and what each alternative has that Playdeck does not, and the reverse.
//
// Every cell here is a claim, and every claim carries an `anchor` the
// generator re-evaluates against the actually-installed package on every run
// -- see that script's header for the anchor kinds. This file supplies the
// claims; it does not check them.
//
// A few conventions the generator does not enforce, because they are about
// what to write rather than how to check it:
//
// - `status: 'no'` is never written without a checked `source` naming what
//   was read to conclude the feature is absent -- "no export found" on its
//   own is exactly the impression this issue rules out. An absence is
//   searched across everything the package ships, never one file that could
//   not have carried the answer either way (`absent-in-tree`).
// - Where the obvious token for an axis collides with an unrelated
//   identifier in one library -- Vidstack's `PlaylistIcon` art, react-player's
//   oEmbed `thumbnail_url` -- the anchor narrows to a token that does not, and
//   the note names the collision rather than leaving a reader to wonder why
//   this column's token differs.
// - A status describes the library's own API and UI for its own file or
//   native playback. It never encodes which of a library's providers can do
//   the thing: a YouTube iframe cannot enter picture-in-picture under any
//   library here, so that limit is written in the note, in every column
//   alike.
// - `status: 'plugin'` names the plugin in `plugin`, with the GitHub owner
//   its own published npm manifest points at, and only for a plugin that is
//   itself documented (its own README, its own docs page, or the library's
//   own docs naming it) -- never a guess at what probably exists. The two
//   words for provenance are derived from that field, not chosen: a plugin
//   whose repository owner is the same GitHub org that publishes the library
//   is `org-published`, and anything else is `third-party`, with the owner
//   printed beside it so a reader can disagree with the word and still have
//   the fact. Where the published manifest declares no `repository` at all,
//   `repository` is `null` and no word is claimed.
// - `status: 'n/a'` is for an axis that cannot apply to a library at all,
//   with a note saying why -- distinct from `no`, which is a library that
//   could have shipped the thing and did not.
// - No cell characterises another project's authors, intentions or quality.
//   Where an alternative's own docs frame a gap as a deliberate choice, the
//   note quotes that source rather than saying "lacks".
// - Playdeck's own cells follow the identical rule and carry no adjective the
//   other rows do not: a headless library with fewer built-in UI parts is not
//   "worse" here, it is a different row with the same anchor discipline as
//   every other one.

/**
 * @typedef {{ kind: 'export'; module: string; name: string }} ExportAnchor
 * @typedef {{ kind: 'file' | 'types'; module: string; path: string; includes: string }} FileAnchor
 * @typedef {{ kind: 'package'; module: string; field: string }} PackageAnchor
 * @typedef {{ kind: 'absent'; module: string; field: string }} AbsentFieldAnchor
 * @typedef {{ kind: 'absent-in-tree'; module: string | readonly string[]; glob: string | readonly string[]; includes?: string }} AbsentInTreeAnchor
 * @typedef {{ kind: 'imports-in-node'; module: string; expect: 'imports' | 'throws' }} ImportsInNodeAnchor
 * @typedef {ExportAnchor | FileAnchor | PackageAnchor | AbsentFieldAnchor | AbsentInTreeAnchor | ImportsInNodeAnchor} Anchor
 * @typedef {{ name: string; repository: string; provenance: 'org-published' | 'third-party' } | { name: string; repository: null }} PluginProvenance
 * @typedef {{ status: 'yes' | 'partial' | 'no' | 'plugin' | 'n/a'; anchor: Anchor; source: string; note?: string; plugin?: PluginProvenance }} Cell
 * @typedef {{ id: string; label: string; entries: Record<string, Cell> }} Axis
 */

const REACT_PLAYER_README =
  'react-player 3.4.0, node_modules/react-player/README.md (installed package)';
const REACT_PLAYER_TYPES =
  'react-player 3.4.0, node_modules/react-player/dist/types.d.ts (installed package)';
const REACT_PLAYER_TREE =
  'react-player 3.4.0, every `.js` and `.d.ts` file in node_modules/react-player (installed package)';
const VIDSTACK_DOCS = '[vidstack.io](https://vidstack.io)';
const VIDSTACK_TREE =
  '@vidstack/react 1.15.6, every `.js` and `.d.ts` file in node_modules/@vidstack/react (installed package)';
const MEDIA_CHROME_README =
  'media-chrome 4.19.2, node_modules/media-chrome/README.md (installed package)';
const MEDIA_CHROME_ELEMENTS_DOCS =
  '[media-chrome.org/docs/en/media-element](https://www.media-chrome.org/docs/en/media-element#compatible-media-elements)';
const MEDIA_CHROME_TREE =
  'media-chrome 4.19.2, every `.js` and `.d.ts` file in node_modules/media-chrome (installed package)';
const VIDEOJS_DIST =
  'video.js 8.24.0, node_modules/video.js/dist/video.es.js (installed package)';
const VIDEOJS_PKG =
  'video.js 8.24.0, node_modules/video.js/package.json (installed package)';
const VIDEOJS_TREE =
  'video.js 8.24.0, every `.js` and `.d.ts` file in node_modules/video.js (installed package)';
const VIDEOJS10_TYPES =
  '@videojs/react 10.0.0-beta.32, node_modules/@videojs/react/dist/dev/index.d.ts (installed package)';
const VIDEOJS10_PKG =
  '@videojs/react 10.0.0-beta.32, node_modules/@videojs/react/package.json (installed package)';
const VIDEOJS10_TREE =
  '@videojs/react 10.0.0-beta.32, every `.js` and `.d.ts` file in node_modules/@videojs/react (installed package)';
const VIDEOJS10_DOCS =
  '@videojs/react 10.0.0-beta.32, node_modules/@videojs/react/docs (the package ships its own documentation)';
const PLAYDECK_REACT_README = 'packages/react/README.md';
const PLAYDECK_TREE =
  'packages/core and packages/react, every `.js` and `.d.ts` file each ships under `dist/` after `pnpm build`';

/** @type {readonly Axis[]} */
export const axes = [
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
      },
      'Video.js 10 (beta)': {
        status: 'yes',
        anchor: {
          kind: 'export',
          module: '@videojs/react',
          name: 'CaptionsButton'
        },
        source: VIDEOJS10_TYPES
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
          kind: 'absent-in-tree',
          module: 'react-player',
          glob: ['**/*.js', '**/*.d.ts'],
          includes: 'Quality'
        },
        source: REACT_PLAYER_TREE
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
      },
      'Video.js 10 (beta)': {
        status: 'yes',
        anchor: {
          kind: 'export',
          module: '@videojs/react',
          name: 'QualityRadioGroup'
        },
        source: VIDEOJS10_TYPES
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
        source: REACT_PLAYER_TYPES,
        note: 'A `playbackRate` prop sets the rate; no playback-rate control of react-player\'s own ships. Provider limit, not a status: its own README says the prop is "Only supported by YouTube, Wistia, and file paths".'
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
      },
      'Video.js 10 (beta)': {
        status: 'yes',
        anchor: {
          kind: 'export',
          module: '@videojs/react',
          name: 'PlaybackRateButton'
        },
        source: VIDEOJS10_TYPES
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
        source: PLAYDECK_REACT_README,
        note: "Provider limit, not a status: Playdeck's YouTube adapter reports this capability as provider-unavailable (`packages/provider-youtube/src/adapter-values.ts`), as an embedded player would under any library here."
      },
      'react-player': {
        status: 'partial',
        anchor: {
          kind: 'types',
          module: 'react-player',
          path: 'dist/types.d.ts',
          includes: 'pip?: boolean;'
        },
        source: REACT_PLAYER_TYPES,
        note: 'A `pip` prop enters and leaves picture-in-picture; no picture-in-picture control of react-player\'s own ships. Provider limit, not a status: its own README says it is "Only available when playing file URLs in certain browsers".'
      },
      Vidstack: {
        status: 'yes',
        anchor: {
          kind: 'export',
          module: '@vidstack/react',
          name: 'PIPButton'
        },
        source: VIDSTACK_DOCS,
        note: 'Provider limit, not a status: Vidstack publishes this as provider-dependent player state, which an embedded provider leaves unset.'
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
      },
      'Video.js 10 (beta)': {
        status: 'yes',
        anchor: {
          kind: 'export',
          module: '@videojs/react',
          name: 'PiPButton'
        },
        source: VIDEOJS10_TYPES
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
          kind: 'absent-in-tree',
          module: 'react-player',
          glob: ['**/*.js', '**/*.d.ts'],
          includes: 'fullscreen'
        },
        source: REACT_PLAYER_TREE,
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
      },
      'Video.js 10 (beta)': {
        status: 'yes',
        anchor: {
          kind: 'export',
          module: '@videojs/react',
          name: 'FullscreenButton'
        },
        source: VIDEOJS10_TYPES
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
        source: PLAYDECK_REACT_README,
        note: "Provider limit, not a status: Playdeck's YouTube adapter reports this capability as provider-unavailable (`packages/provider-youtube/src/adapter-values.ts`), as an embedded player would under any library here."
      },
      'react-player': {
        status: 'no',
        anchor: {
          kind: 'absent-in-tree',
          module: 'react-player',
          glob: ['**/*.js', '**/*.d.ts'],
          includes: 'irplay'
        },
        source: REACT_PLAYER_TREE,
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
          kind: 'absent-in-tree',
          module: 'video.js',
          glob: ['**/*.js', '**/*.d.ts'],
          includes: 'AirPlay'
        },
        source:
          '[registry.npmjs.org/videojs-airplay](https://registry.npmjs.org/videojs-airplay)',
        note: 'No AirPlay button in core.',
        plugin: {
          name: 'videojs-airplay',
          repository: 'github.com/jgubman/videojs-airplay',
          provenance: 'third-party'
        }
      },
      'Video.js 10 (beta)': {
        status: 'yes',
        anchor: {
          kind: 'export',
          module: '@videojs/react',
          name: 'AirPlayButton'
        },
        source: VIDEOJS10_TYPES
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
          kind: 'absent-in-tree',
          module: ['@playdeck/core', '@playdeck/react'],
          glob: ['**/*.js', '**/*.d.ts'],
          includes: 'Cast'
        },
        source: PLAYDECK_TREE,
        note: 'No casting command, capability, provider or UI part ships; AirPlay is the only remote-playback route.'
      },
      'react-player': {
        status: 'no',
        anchor: {
          kind: 'absent-in-tree',
          module: 'react-player',
          glob: ['**/*.js', '**/*.d.ts'],
          includes: 'Cast'
        },
        source: REACT_PLAYER_TREE
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
          kind: 'absent-in-tree',
          module: 'video.js',
          glob: ['**/*.js', '**/*.d.ts'],
          includes: 'CastButton'
        },
        source:
          '[registry.npmjs.org/videojs-chromecast](https://registry.npmjs.org/videojs-chromecast)',
        note: 'Core only detects a Chromecast _receiver_ context (`IS_CHROMECAST_RECEIVER`), which is not a sender button.',
        plugin: {
          name: 'videojs-chromecast',
          repository: 'github.com/benjipott/video.js-chromecast',
          provenance: 'third-party'
        }
      },
      'Video.js 10 (beta)': {
        status: 'yes',
        anchor: {
          kind: 'export',
          module: '@videojs/react',
          name: 'CastButton'
        },
        source: VIDEOJS10_TYPES
      }
    }
  },
  {
    id: 'keyboard-operation',
    label: 'Keyboard operation',
    entries: {
      Playdeck: {
        status: 'yes',
        anchor: {
          kind: 'export',
          module: '@playdeck/react',
          name: 'Controls'
        },
        source:
          'packages/react/README.md ("Controls is a focusable region that owns the media keyboard shortcuts")'
      },
      'react-player': {
        status: 'no',
        anchor: {
          kind: 'absent-in-tree',
          module: 'react-player',
          glob: ['**/*.js', '**/*.d.ts'],
          includes: 'keyboard'
        },
        source: REACT_PLAYER_TREE,
        note: "No media keyboard handling of its own (`dist/Preview.js` binds `onKeyDown` for the `light`-mode preview button alone); keyboard operation comes from the native `<video controls>` or an iframe provider's own player."
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
      },
      'Video.js 10 (beta)': {
        status: 'yes',
        anchor: {
          kind: 'export',
          module: '@videojs/react',
          name: 'Hotkey'
        },
        source: VIDEOJS10_TYPES
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
        source: PLAYDECK_REACT_README
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
      },
      'Video.js 10 (beta)': {
        status: 'yes',
        anchor: {
          kind: 'file',
          module: '@videojs/react',
          path: 'dist/default/player/container.js',
          includes: 'aria-label'
        },
        source: VIDEOJS10_TREE
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
          kind: 'absent-in-tree',
          module: ['@playdeck/core', '@playdeck/react'],
          glob: ['**/*.js', '**/*.d.ts'],
          includes: 'requestMediaKeySystemAccess'
        },
        source: PLAYDECK_TREE
      },
      'react-player': {
        status: 'no',
        anchor: {
          kind: 'absent-in-tree',
          module: 'react-player',
          glob: ['**/*.js', '**/*.d.ts'],
          includes: 'requestMediaKeySystemAccess'
        },
        source: REACT_PLAYER_TREE
      },
      Vidstack: {
        status: 'no',
        anchor: {
          kind: 'absent-in-tree',
          module: '@vidstack/react',
          glob: ['**/*.js', '**/*.d.ts'],
          includes: 'requestMediaKeySystemAccess'
        },
        source: VIDSTACK_TREE
      },
      'Media Chrome': {
        status: 'no',
        anchor: {
          kind: 'absent-in-tree',
          module: 'media-chrome',
          glob: ['**/*.js', '**/*.d.ts'],
          includes: 'requestMediaKeySystemAccess'
        },
        source: MEDIA_CHROME_TREE
      },
      'Video.js': {
        status: 'plugin',
        anchor: {
          kind: 'absent-in-tree',
          module: 'video.js',
          glob: ['**/*.js', '**/*.d.ts'],
          includes: 'requestMediaKeySystemAccess'
        },
        source:
          '[registry.npmjs.org/videojs-contrib-eme](https://registry.npmjs.org/videojs-contrib-eme)',
        note: 'Core has no EME call of its own.',
        plugin: {
          name: 'videojs-contrib-eme',
          repository: null
        }
      },
      'Video.js 10 (beta)': {
        status: 'yes',
        anchor: {
          kind: 'export',
          module: '@videojs/react',
          name: 'KeySystems'
        },
        source:
          VIDEOJS10_DOCS + ' (`reference/shaka-video.md`, "Protected content")',
        note: "A `source.drm` map of EME key-system ids on `ShakaVideo` and `HlsjsVideo`; the playback engine behind it (shaka-player, hls.js) is the consumer's own install."
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
          kind: 'absent-in-tree',
          module: 'media-chrome',
          glob: ['**/*.js', '**/*.d.ts'],
          includes: 'hls'
        },
        source: MEDIA_CHROME_ELEMENTS_DOCS,
        note: 'No provider or engine module of its own; the documented compatible element is `<hls-video>`.',
        plugin: {
          name: 'hls-video-element',
          repository: 'github.com/muxinc/media-elements',
          provenance: 'org-published'
        }
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
      },
      'Video.js 10 (beta)': {
        status: 'yes',
        anchor: {
          kind: 'export',
          module: '@videojs/react/media/hls-video',
          name: 'HlsVideo'
        },
        source: VIDEOJS10_TREE
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
          kind: 'absent-in-tree',
          module: ['@playdeck/core', '@playdeck/react'],
          glob: ['**/*.js', '**/*.d.ts'],
          includes: 'dash'
        },
        source: PLAYDECK_TREE,
        note: '`PlayerSource` is a closed union of `string | VideoFileSource | HlsSource | YouTubeSource | VimeoSource | WistiaSource` (packages/core/dist/types.d.ts); `.out-of-scope/dash.md` records the decision.'
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
          kind: 'absent-in-tree',
          module: 'media-chrome',
          glob: ['**/*.js', '**/*.d.ts'],
          includes: 'DashVideo'
        },
        source: MEDIA_CHROME_ELEMENTS_DOCS,
        note: 'No provider or engine module of its own; the documented compatible element is `<dash-video>`.',
        plugin: {
          name: 'dash-video-element',
          repository: 'github.com/muxinc/media-elements',
          provenance: 'org-published'
        }
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
      },
      'Video.js 10 (beta)': {
        status: 'yes',
        anchor: {
          kind: 'export',
          module: '@videojs/react/media/dash-video',
          name: 'DashVideo'
        },
        source: VIDEOJS10_TREE
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
          kind: 'absent-in-tree',
          module: 'react-player',
          glob: ['**/*.js', '**/*.d.ts'],
          includes: 'isLive'
        },
        source: REACT_PLAYER_TREE
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
      },
      'Video.js 10 (beta)': {
        status: 'yes',
        anchor: {
          kind: 'export',
          module: '@videojs/react',
          name: 'LiveButton'
        },
        source: VIDEOJS10_TYPES
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
          kind: 'absent-in-tree',
          module: 'media-chrome',
          glob: ['**/*.js', '**/*.d.ts'],
          includes: 'youtube'
        },
        source: MEDIA_CHROME_ELEMENTS_DOCS,
        note: 'No provider module of its own; the documented compatible element is `<youtube-video>`.',
        plugin: {
          name: 'youtube-video-element',
          repository: 'github.com/muxinc/media-elements',
          provenance: 'org-published'
        }
      },
      'Video.js': {
        status: 'plugin',
        anchor: {
          kind: 'absent-in-tree',
          module: 'video.js',
          glob: ['**/*.js', '**/*.d.ts'],
          includes: 'youtube'
        },
        source:
          '[registry.npmjs.org/videojs-youtube](https://registry.npmjs.org/videojs-youtube)',
        note: 'No YouTube tech in core.',
        plugin: {
          name: 'videojs-youtube',
          repository: 'github.com/videojs/videojs-youtube',
          provenance: 'org-published'
        }
      },
      'Video.js 10 (beta)': {
        status: 'yes',
        anchor: {
          kind: 'export',
          module: '@videojs/react/media/youtube-video',
          name: 'YouTubeVideo'
        },
        source: VIDEOJS10_TREE
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
          kind: 'absent-in-tree',
          module: 'media-chrome',
          glob: ['**/*.js', '**/*.d.ts'],
          includes: 'vimeo'
        },
        source: MEDIA_CHROME_ELEMENTS_DOCS,
        note: 'No provider module of its own; the documented compatible element is `<vimeo-video>`.',
        plugin: {
          name: 'vimeo-video-element',
          repository: 'github.com/muxinc/media-elements',
          provenance: 'org-published'
        }
      },
      'Video.js': {
        status: 'plugin',
        anchor: {
          kind: 'absent-in-tree',
          module: 'video.js',
          glob: ['**/*.js', '**/*.d.ts'],
          includes: 'vimeo'
        },
        source:
          '[registry.npmjs.org/videojs-vimeo](https://registry.npmjs.org/videojs-vimeo)',
        note: 'No Vimeo tech in core.',
        plugin: {
          name: 'videojs-vimeo',
          repository: 'github.com/eXon/videojs-vimeo',
          provenance: 'third-party'
        }
      },
      'Video.js 10 (beta)': {
        status: 'yes',
        anchor: {
          kind: 'export',
          module: '@videojs/react/media/vimeo-video',
          name: 'VimeoVideo'
        },
        source: VIDEOJS10_TREE
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
          kind: 'absent-in-tree',
          module: '@vidstack/react',
          glob: ['**/*.js', '**/*.d.ts'],
          includes: 'Wistia'
        },
        source: VIDSTACK_TREE
      },
      'Media Chrome': {
        status: 'plugin',
        anchor: {
          kind: 'absent-in-tree',
          module: 'media-chrome',
          glob: ['**/*.js', '**/*.d.ts'],
          includes: 'wistia'
        },
        source: MEDIA_CHROME_ELEMENTS_DOCS,
        note: 'No provider module of its own; the documented compatible element is `<wistia-video>`.',
        plugin: {
          name: 'wistia-video-element',
          repository: 'github.com/muxinc/media-elements',
          provenance: 'org-published'
        }
      },
      'Video.js': {
        status: 'no',
        anchor: {
          kind: 'absent-in-tree',
          module: 'video.js',
          glob: ['**/*.js', '**/*.d.ts'],
          includes: 'Wistia'
        },
        source: VIDEOJS_TREE
      },
      'Video.js 10 (beta)': {
        status: 'no',
        anchor: {
          kind: 'absent-in-tree',
          module: '@videojs/react',
          glob: ['**/*.js', '**/*.d.ts'],
          includes: 'istia'
        },
        source: VIDEOJS10_TREE
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
          kind: 'absent-in-tree',
          module: ['@playdeck/core', '@playdeck/react'],
          glob: ['**/*.js', '**/*.d.ts'],
          includes: 'Twitch'
        },
        source: PLAYDECK_TREE,
        note: '`PlayerSource` is a closed union of exactly five source kinds (packages/core/dist/types.d.ts), so no further hosted platform can be passed.'
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
          kind: 'absent-in-tree',
          module: '@vidstack/react',
          glob: ['**/*.js', '**/*.d.ts'],
          includes: 'Twitch'
        },
        source: VIDSTACK_TREE,
        note: 'Providers beyond HLS/DASH/YouTube/Vimeo/audio/video are not hosted platforms (e.g. a Remotion render provider).'
      },
      'Media Chrome': {
        status: 'plugin',
        anchor: {
          kind: 'absent-in-tree',
          module: 'media-chrome',
          glob: ['**/*.js', '**/*.d.ts'],
          includes: 'cloudflare'
        },
        source: MEDIA_CHROME_ELEMENTS_DOCS,
        note: 'Documented compatible elements also include Cloudflare (`<cloudflare-video>`), JW Player, Mux, Shaka Player and Spotify.',
        plugin: {
          name: 'cloudflare-video-element',
          repository: 'github.com/muxinc/media-elements',
          provenance: 'org-published'
        }
      },
      'Video.js': {
        status: 'no',
        anchor: {
          kind: 'absent-in-tree',
          module: 'video.js',
          glob: ['**/*.js', '**/*.d.ts'],
          includes: 'Twitch'
        },
        source: VIDEOJS_TREE
      },
      'Video.js 10 (beta)': {
        status: 'yes',
        anchor: {
          kind: 'export',
          module: '@videojs/react/media/twitch-video',
          name: 'TwitchVideo'
        },
        source: VIDEOJS10_TREE,
        note: 'Twitch, TikTok, Spotify, Cloudflare Stream and Mux each ship as their own media component under the `@videojs/react/media/*` subpath.'
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
          kind: 'absent-in-tree',
          module: ['@playdeck/core', '@playdeck/react'],
          glob: ['**/*.js', '**/*.d.ts'],
          includes: 'AudioTrack'
        },
        source: PLAYDECK_TREE
      },
      'react-player': {
        status: 'no',
        anchor: {
          kind: 'absent-in-tree',
          module: 'react-player',
          glob: ['**/*.js', '**/*.d.ts'],
          includes: 'AudioTrack'
        },
        source: REACT_PLAYER_TREE
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
      },
      'Video.js 10 (beta)': {
        status: 'yes',
        anchor: {
          kind: 'export',
          module: '@videojs/react',
          name: 'AudioTrackRadioGroup'
        },
        source: VIDEOJS10_TYPES
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
          kind: 'absent-in-tree',
          module: 'react-player',
          glob: ['**/*.js', '**/*.d.ts'],
          includes: 'hapter'
        },
        source: REACT_PLAYER_TREE
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
      },
      'Video.js 10 (beta)': {
        status: 'yes',
        anchor: {
          kind: 'types',
          module: '@videojs/react',
          path: 'dist/dev/index.d.ts',
          includes: 'TimeSliderChapters'
        },
        source: VIDEOJS10_TYPES
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
          kind: 'absent-in-tree',
          module: ['@playdeck/core', '@playdeck/react'],
          glob: ['**/*.js', '**/*.d.ts'],
          includes: 'thumbnails'
        },
        source: PLAYDECK_TREE
      },
      'react-player': {
        status: 'no',
        anchor: {
          kind: 'absent-in-tree',
          module: 'react-player',
          glob: ['**/*.js', '**/*.d.ts'],
          includes: 'thumbnails'
        },
        source: REACT_PLAYER_TREE,
        note: 'The `light` prop is a static startup poster fetched through oEmbed (`thumbnail_url` in `dist/Preview.js`), not a hover/scrub seek preview.'
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
          kind: 'absent-in-tree',
          module: 'video.js',
          glob: ['**/*.js', '**/*.d.ts'],
          includes: 'thumbnails'
        },
        source:
          '[registry.npmjs.org/videojs-sprite-thumbnails](https://registry.npmjs.org/videojs-sprite-thumbnails)',
        note: 'No seek-preview thumbnail support in core.',
        plugin: {
          name: 'videojs-sprite-thumbnails',
          repository: 'github.com/phloxic/videojs-sprite-thumbnails',
          provenance: 'third-party'
        }
      },
      'Video.js 10 (beta)': {
        status: 'yes',
        anchor: {
          kind: 'export',
          module: '@videojs/react',
          name: 'Thumbnail'
        },
        source: VIDEOJS10_TYPES
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
          kind: 'absent-in-tree',
          module: ['@playdeck/core', '@playdeck/react'],
          glob: ['**/*.js', '**/*.d.ts'],
          includes: 'Playlist'
        },
        source: PLAYDECK_TREE,
        note: '`Root` takes one `source`, not a list.'
      },
      'react-player': {
        status: 'no',
        anchor: {
          kind: 'absent-in-tree',
          module: 'react-player',
          glob: ['**/*.js', '**/*.d.ts'],
          includes: 'Playlist'
        },
        source: REACT_PLAYER_TREE
      },
      Vidstack: {
        status: 'no',
        anchor: {
          kind: 'absent-in-tree',
          module: '@vidstack/react',
          glob: ['**/*.js', '**/*.d.ts'],
          includes: 'PlaylistInstance'
        },
        source: VIDSTACK_TREE,
        note: 'The only `Playlist` string in the package is the `PlaylistIcon` art in `icons.d.ts`; no playlist component or state ships.'
      },
      'Media Chrome': {
        status: 'no',
        anchor: {
          kind: 'absent-in-tree',
          module: 'media-chrome',
          glob: ['**/*.js', '**/*.d.ts'],
          includes: 'Playlist'
        },
        source: MEDIA_CHROME_TREE
      },
      'Video.js': {
        status: 'plugin',
        anchor: {
          kind: 'absent-in-tree',
          module: 'video.js',
          glob: ['**/*.js', '**/*.d.ts'],
          includes: "registerComponent('Playlist"
        },
        source:
          '[registry.npmjs.org/videojs-playlist](https://registry.npmjs.org/videojs-playlist)',
        note: 'No playlist component in core (the `Playlist` strings in `core.es.js` are HLS media-playlist parsing).',
        plugin: {
          name: 'videojs-playlist',
          repository: 'github.com/brightcove/videojs-playlist',
          provenance: 'third-party'
        }
      },
      'Video.js 10 (beta)': {
        status: 'no',
        anchor: {
          kind: 'absent-in-tree',
          module: '@videojs/react',
          glob: ['**/*.js', '**/*.d.ts'],
          includes: 'Playlist'
        },
        source:
          VIDEOJS10_DOCS + ' (`how-to/migrate-from-video-js-8.md`, "Plugins")',
        note: 'Its own migration guide lists playlists among the "genuinely missing features" that "need real work".'
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
          kind: 'absent-in-tree',
          module: ['@playdeck/core', '@playdeck/react'],
          glob: ['**/*.js', '**/*.d.ts'],
          includes: 'AdBreak'
        },
        source: PLAYDECK_TREE
      },
      'react-player': {
        status: 'no',
        anchor: {
          kind: 'absent-in-tree',
          module: 'react-player',
          glob: ['**/*.js', '**/*.d.ts'],
          includes: 'AdBreak'
        },
        source: REACT_PLAYER_TREE
      },
      Vidstack: {
        status: 'no',
        anchor: {
          kind: 'absent-in-tree',
          module: '@vidstack/react',
          glob: ['**/*.js', '**/*.d.ts'],
          includes: 'AdBreak'
        },
        source: VIDSTACK_TREE
      },
      'Media Chrome': {
        status: 'no',
        anchor: {
          kind: 'absent-in-tree',
          module: 'media-chrome',
          glob: ['**/*.js', '**/*.d.ts'],
          includes: 'AdBreak'
        },
        source: MEDIA_CHROME_TREE
      },
      'Video.js': {
        status: 'plugin',
        anchor: {
          kind: 'absent-in-tree',
          module: 'video.js',
          glob: ['**/*.js', '**/*.d.ts'],
          includes: 'AdBreak'
        },
        source:
          '[registry.npmjs.org/videojs-contrib-ads](https://registry.npmjs.org/videojs-contrib-ads)',
        note: "No ad support in core; the ad-timeline framework is paired with Google's `videojs-ima`.",
        plugin: {
          name: 'videojs-contrib-ads',
          repository: 'github.com/videojs/videojs-contrib-ads',
          provenance: 'org-published'
        }
      },
      'Video.js 10 (beta)': {
        status: 'no',
        anchor: {
          kind: 'absent-in-tree',
          module: '@videojs/react',
          glob: ['**/*.js', '**/*.d.ts'],
          includes: 'AdBreak'
        },
        source:
          VIDEOJS10_DOCS + ' (`how-to/migrate-from-video-js-8.md`, "Plugins")',
        note: 'Its own migration guide says "If your player depends on an ads plugin, there\'s no v10 answer today".'
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
          kind: 'absent-in-tree',
          module: ['@playdeck/core', '@playdeck/react'],
          glob: ['**/*.js', '**/*.d.ts'],
          includes: 'Analytics'
        },
        source: PLAYDECK_TREE
      },
      'react-player': {
        status: 'no',
        anchor: {
          kind: 'absent-in-tree',
          module: 'react-player',
          glob: ['**/*.js', '**/*.d.ts'],
          includes: 'Analytics'
        },
        source: REACT_PLAYER_TREE
      },
      Vidstack: {
        status: 'no',
        anchor: {
          kind: 'absent-in-tree',
          module: '@vidstack/react',
          glob: ['**/*.js', '**/*.d.ts'],
          includes: 'AnalyticsInstance'
        },
        source: VIDSTACK_TREE,
        note: 'The only `Analytics` string in the package documents a YouTube embed parameter (`types/vidstack-instances.d.ts`); no analytics component ships.'
      },
      'Media Chrome': {
        status: 'no',
        anchor: {
          kind: 'absent-in-tree',
          module: 'media-chrome',
          glob: ['**/*.js', '**/*.d.ts'],
          includes: 'Analytics'
        },
        source: MEDIA_CHROME_TREE
      },
      'Video.js': {
        status: 'plugin',
        anchor: {
          kind: 'absent-in-tree',
          module: 'video.js',
          glob: ['**/*.js', '**/*.d.ts'],
          includes: 'Analytics'
        },
        source:
          '[registry.npmjs.org/videojs-mux](https://registry.npmjs.org/videojs-mux)',
        note: 'No analytics reporting in core; `videojs-mux` is the Mux Data SDK for Video.js.',
        plugin: {
          name: 'videojs-mux',
          repository: null
        }
      },
      'Video.js 10 (beta)': {
        status: 'yes',
        anchor: {
          kind: 'export',
          module: '@videojs/react/media/mux-data',
          name: 'MuxData'
        },
        source: VIDEOJS10_DOCS + ' (`concepts/mux-data.md`)',
        note: 'A `MuxData` component ships in the package; it reports to Mux Data, and no other analytics vendor has a component here.'
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
          kind: 'absent-in-tree',
          module: ['@playdeck/core', '@playdeck/react'],
          glob: ['**/*.js', '**/*.d.ts'],
          includes: 'registerPlugin'
        },
        source: PLAYDECK_TREE,
        note: 'Extensibility is React composition (compose primitives, pass props/render props), not a plugin registry.'
      },
      'react-player': {
        status: 'yes',
        anchor: {
          kind: 'file',
          module: 'react-player',
          path: 'README.md',
          includes: 'addCustomPlayer'
        },
        source:
          'react-player 3.4.0, node_modules/react-player/README.md (installed package), the `addCustomPlayer` / `removeCustomPlayers` lines',
        note: '`ReactPlayer.addCustomPlayer` and `removeCustomPlayers` register and drop a custom player implementation.'
      },
      Vidstack: {
        status: 'no',
        anchor: {
          kind: 'absent-in-tree',
          module: '@vidstack/react',
          glob: ['**/*.js', '**/*.d.ts'],
          includes: 'registerPlugin'
        },
        source: VIDSTACK_TREE
      },
      'Media Chrome': {
        status: 'no',
        anchor: {
          kind: 'absent-in-tree',
          module: 'media-chrome',
          glob: ['**/*.js', '**/*.d.ts'],
          includes: 'registerPlugin'
        },
        source: MEDIA_CHROME_TREE,
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
      },
      'Video.js 10 (beta)': {
        status: 'no',
        anchor: {
          kind: 'absent-in-tree',
          module: '@videojs/react',
          glob: ['**/*.js', '**/*.d.ts'],
          includes: 'registerPlugin'
        },
        source:
          VIDEOJS10_DOCS + ' (`how-to/migrate-from-video-js-8.md`, "Plugins")',
        note: 'Its own migration guide opens that section "v10 has no plugin system"; extension is composition, an ejected skin, or a swapped media component.'
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
        note: '`theme.css` and `docked.css` are exports entries the primitives never import themselves (see "requires an external stylesheet" below).'
      },
      'react-player': {
        status: 'no',
        anchor: {
          kind: 'absent-in-tree',
          module: 'react-player',
          glob: ['**/*.css']
        },
        source: REACT_PLAYER_TREE,
        note: "Ships no CSS file at all; visible controls are always the native `<video>` chrome or an iframe provider's own UI."
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
          kind: 'absent-in-tree',
          module: 'media-chrome',
          glob: ['**/*.css', 'dist/themes/**/*']
        },
        source: MEDIA_CHROME_TREE,
        note: "No stylesheet and no `dist/themes` directory ship. `MediaThemeElement` is a theming _engine_ for a consumer's own template, not a pre-built skin."
      },
      'Video.js': {
        status: 'yes',
        anchor: {
          kind: 'package',
          module: 'video.js',
          field: 'style'
        },
        source: VIDEOJS_PKG
      },
      'Video.js 10 (beta)': {
        status: 'yes',
        anchor: {
          kind: 'file',
          module: '@videojs/react',
          path: 'package.json',
          includes: '"./video/*.css"'
        },
        source: VIDEOJS10_PKG,
        note: 'The `@videojs/react/video` preset ships `skin.css` and `minimal-skin.css` beside its `VideoSkin` component.'
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
          kind: 'absent-in-tree',
          module: 'react-player',
          glob: ['**/*.js', '**/*.d.ts'],
          includes: 'PlayButton'
        },
        source: REACT_PLAYER_TREE,
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
          kind: 'absent-in-tree',
          module: 'video.js',
          glob: ['**/*.js', '**/*.d.ts'],
          includes: 'jsx-runtime'
        },
        source: VIDEOJS_TREE,
        note: 'This pinned package ships no React integration at all, so it has no React parts to import; its own components are reachable imperatively (`player.controlBar.getChild(...)`). The videojs GitHub org publishes a separate React library, `@videojs/react`, which is the Video.js 10 (beta) column.'
      },
      'Video.js 10 (beta)': {
        status: 'yes',
        anchor: {
          kind: 'export',
          module: '@videojs/react',
          name: 'PlayButton'
        },
        source: VIDEOJS10_TYPES
      }
    }
  },
  {
    id: 'required-stylesheet',
    label: 'Requires an external stylesheet for usable controls',
    entries: {
      Playdeck: {
        status: 'no',
        anchor: {
          kind: 'absent-in-tree',
          module: ['@playdeck/core', '@playdeck/react'],
          glob: ['**/*.js'],
          includes: '.css'
        },
        source: PLAYDECK_TREE,
        note: 'No shipped JavaScript imports a stylesheet; an unstyled composition still renders and operates.'
      },
      'react-player': {
        status: 'no',
        anchor: {
          kind: 'absent-in-tree',
          module: 'react-player',
          glob: ['**/*.js'],
          includes: '.css'
        },
        source: REACT_PLAYER_TREE
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
        source: MEDIA_CHROME_TREE,
        note: 'Each custom element ships its own Shadow DOM styles.'
      },
      'Video.js': {
        status: 'yes',
        anchor: {
          kind: 'package',
          module: 'video.js',
          field: 'style'
        },
        source: VIDEOJS_PKG
      },
      'Video.js 10 (beta)': {
        status: 'yes',
        anchor: {
          kind: 'types',
          module: '@videojs/react',
          path: 'dist/dev/presets/video/skin.d.ts',
          includes: 'skin.css'
        },
        source: VIDEOJS10_TYPES,
        note: 'The skin\'s own type declaration says to "import `@videojs/react/video/skin.css` for the packaged styles".'
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
        source:
          'packages/react/README.md ("Provider packages are pulled in as dependencies but loaded lazily")'
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
        status: 'n/a',
        anchor: {
          kind: 'absent-in-tree',
          module: 'media-chrome',
          glob: ['**/*.js', '**/*.d.ts'],
          includes: 'hls'
        },
        source: MEDIA_CHROME_TREE,
        note: 'The axis cannot apply: media-chrome ships no provider or engine module of its own to defer -- its controller wraps whatever media element a consumer slots in.'
      },
      'Video.js': {
        status: 'no',
        anchor: {
          kind: 'absent-in-tree',
          module: 'video.js',
          glob: ['**/*.js'],
          includes: 'import('
        },
        source: VIDEOJS_TREE,
        note: 'The HLS/DASH engine (videojs-http-streaming, mpd-parser, m3u8-parser) is a static import with no dynamic boundary.'
      },
      'Video.js 10 (beta)': {
        status: 'no',
        anchor: {
          kind: 'absent-in-tree',
          module: '@videojs/react',
          glob: ['**/*.js'],
          includes: 'import('
        },
        source: VIDEOJS10_TREE,
        note: 'No dynamic `import()` in any shipped JavaScript; each media component is instead its own `@videojs/react/media/*` subpath a consumer imports statically, so a page pays only for the one it names.'
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
        note: '`>=19 <20` -- React 19 only.'
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
        source: VIDEOJS_PKG,
        note: 'This pinned package ships no React integration, so it declares no React range. The videojs GitHub org publishes a separate React library, `@videojs/react`, which is the Video.js 10 (beta) column and declares `^18.0.0 || ^19.0.0`.'
      },
      'Video.js 10 (beta)': {
        status: 'yes',
        anchor: {
          kind: 'package',
          module: '@videojs/react',
          field: 'peerDependencies.react'
        },
        source: VIDEOJS10_PKG,
        note: '`^18.0.0 || ^19.0.0`.'
      }
    }
  },
  {
    id: 'ssr',
    label: 'Imports on a server (no DOM globals)',
    entries: {
      Playdeck: {
        status: 'yes',
        anchor: {
          kind: 'imports-in-node',
          module: '@playdeck/react',
          expect: 'imports'
        },
        source: PLAYDECK_REACT_README
      },
      'react-player': {
        status: 'yes',
        anchor: {
          kind: 'imports-in-node',
          module: 'react-player',
          expect: 'imports'
        },
        source: REACT_PLAYER_TREE
      },
      Vidstack: {
        status: 'yes',
        anchor: {
          kind: 'imports-in-node',
          module: '@vidstack/react',
          expect: 'imports'
        },
        source: VIDSTACK_TREE,
        note: "Also ships a dedicated `server`/`worker` build condition (`server/vidstack.js`) alongside the `'use client'` entry."
      },
      'Media Chrome': {
        status: 'yes',
        anchor: {
          kind: 'imports-in-node',
          module: 'media-chrome',
          expect: 'imports'
        },
        source: MEDIA_CHROME_TREE,
        note: "Renders as inert custom-element markup during SSR (guarded by `isServer`) without a `'use client'` boundary; behaviour attaches on hydration."
      },
      'Video.js': {
        status: 'yes',
        anchor: {
          kind: 'imports-in-node',
          module: 'video.js',
          expect: 'imports'
        },
        source: VIDEOJS_TREE,
        note: "The package Node loads for `import 'video.js'` is its CJS build (`main`, `dist/video.cjs.js`); it loads with no `window` or `document` present. It ships no React integration, so it carries no `'use client'` boundary either way."
      },
      'Video.js 10 (beta)': {
        status: 'yes',
        anchor: {
          kind: 'imports-in-node',
          module: '@videojs/react',
          expect: 'imports'
        },
        source: VIDEOJS10_TREE
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
        anchor: {
          kind: 'package',
          module: '@vidstack/react',
          field: 'types'
        },
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
        anchor: {
          kind: 'package',
          module: 'video.js',
          field: 'types'
        },
        source: VIDEOJS_PKG
      },
      'Video.js 10 (beta)': {
        status: 'yes',
        anchor: {
          kind: 'package',
          module: '@videojs/react',
          field: 'types'
        },
        source: VIDEOJS10_PKG
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
        note: "ESM-only; the `require` condition resolves to a stub that throws by name rather than leaving the failure to Node's own report."
      },
      'react-player': {
        status: 'partial',
        anchor: {
          kind: 'absent-in-tree',
          module: 'react-player',
          glob: ['package.json'],
          includes: '"require":'
        },
        source: 'react-player 3.4.0, node_modules/react-player/package.json',
        note: 'ESM-only (`"type": "module"`, no `require` export condition).'
      },
      Vidstack: {
        status: 'partial',
        anchor: {
          kind: 'absent-in-tree',
          module: '@vidstack/react',
          glob: ['package.json'],
          includes: '"require":'
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
        anchor: {
          kind: 'package',
          module: 'video.js',
          field: 'main'
        },
        source: VIDEOJS_PKG,
        note: '`main` (CJS, `dist/video.cjs.js`) and `module` (ESM, `dist/video.es.js`) are both published.'
      },
      'Video.js 10 (beta)': {
        status: 'partial',
        anchor: {
          kind: 'absent-in-tree',
          module: '@videojs/react',
          glob: ['package.json'],
          includes: '"require":'
        },
        source: VIDEOJS10_PKG,
        note: 'ESM-only (`"type": "module"`, no `require` export condition).'
      }
    }
  }
];
