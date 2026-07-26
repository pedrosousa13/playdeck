import type { PlayerQuality } from '@reely/core';
import * as Player from '@reely/react';
import { useState, type ReactElement } from 'react';

/**
 * The reference composition: one player assembled only from public
 * `@reely/react` / `@reely/core` exports. It is the runnable proof behind
 * criterion 8 of #1, and the artifact #32 points axe and its keyboard flows at.
 *
 * Icons are supplied here, by the consumer, and never defaulted by the
 * primitives — that keeps every icon opt-in and tree-shakeable (#31 task 2).
 * Accessible names come from each primitive's own `aria-label`, not from these
 * children.
 */

// Layout only. `@reely/react/theme.css` is deliberately not mounted: the only
// per-story way to mount it reaches into `packages/`, which this directory may
// not do, and a plain side-effect import would leak the theme into every other
// story's document.
const layoutCss = `
.reely-example {
  position: relative;
  width: 100%;
  max-width: 48rem;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  background: #0b0e13;
  color: #e8edf4;
  font-family: system-ui, sans-serif;
}
.reely-example-controls {
  position: absolute;
  inset: auto 0 0 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.25rem;
  /* Solid, not a gradient: a gradient background makes axe's color-contrast
     check unable to resolve a single background color (#32), and a gradient
     fading to transparent at its own top edge was also genuinely washing out
     the time row's text. Opaque black reads the same as the gradient's
     darkest stop, just consistent across the whole bar instead of fading. */
  background: rgb(4, 6, 10);
}
.reely-example-row {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}
.reely-example-row-buttons {
  flex-wrap: wrap;
}
.reely-example-scrubber {
  flex: 1 1 auto;
  min-width: 0;
}
.reely-example-spacer {
  flex: 1 1 auto;
}
.reely-example [data-reely-part='time'] {
  flex: 0 0 auto;
  font-variant-numeric: tabular-nums;
  font-size: 0.8125rem;
}
.reely-example button {
  flex: 0 0 auto;
  background: transparent;
  border: none;
  border-radius: 4px;
  color: inherit;
  cursor: pointer;
  font-size: 1.125rem;
}
.reely-example button:hover {
  background: rgba(232, 237, 244, 0.16);
}
.reely-example-menu {
  position: absolute;
  bottom: calc(100% + 0.25rem);
  right: 0;
  z-index: 25;
  min-width: 11rem;
  max-height: 12rem;
  overflow-y: auto;
  padding: 0.25rem;
  background: #11151c;
  border: 1px solid #2a2f3a;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
}
.reely-example-menu [data-reely-part='menu-radio-item'] {
  justify-content: flex-start;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
  text-align: left;
}
.reely-example-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  background: rgba(4, 6, 10, 0.86);
  text-align: center;
  padding: 1rem;
}
/* Below this width the button row alone needs the space. Dropping the volume
   slider (rather than letting it squeeze) is what keeps the composition usable
   at 320px, so #32's 1.4.10 reflow check passes by construction. */
@media (max-width: 420px) {
  .reely-example-volume {
    display: none;
  }
}
`;

const rates = ['0.5', '0.75', '1', '1.25', '1.5', '2'] as const;

const qualityLabel = (quality: PlayerQuality): string => {
  if (quality.height !== null) return `${quality.height}p`;
  if (quality.bitrate !== null)
    return `${Math.round(quality.bitrate / 1000)} kbps`;
  return quality.id;
};

const autoLabel = (playing: PlayerQuality | null): string =>
  playing?.height !== null && playing !== null
    ? `Auto (${playing.height}p)`
    : 'Auto';

/**
 * Playback rate and quality in one menu, each group gated on its own
 * capability. The rates are constants the consumer picks; the quality ladder
 * comes from `PlayerState.qualities` (#81) — which is the gap building this
 * example found.
 *
 * No text headings: `role="menu"` only admits menuitem/menuitemradio/group
 * children, so each group is named with `aria-label` instead.
 */
const ExampleSettingsMenu = (): ReactElement | null => {
  const state = Player.usePlayerState((snapshot) => ({
    playbackRate: snapshot.playbackRate,
    rateStatus: snapshot.capabilities.setPlaybackRate.status,
    qualityStatus: snapshot.capabilities.selectQuality.status,
    qualities: snapshot.qualities,
    selectedQualityId: snapshot.selectedQualityId,
    playing: snapshot.quality
  }));
  const actions = Player.usePlayerActions();
  const showRates = state.rateStatus === 'available';
  const showQualities =
    state.qualityStatus === 'available' && state.qualities.length > 0;
  if (!showRates && !showQualities) return null;

  return (
    <Player.SettingsMenu>
      <Player.SettingsMenuTrigger>
        <Player.SettingsIcon />
      </Player.SettingsMenuTrigger>
      <Player.SettingsMenuContent className="reely-example-menu" tabIndex={0}>
        {showRates ? (
          <Player.MenuRadioGroup
            aria-label="Playback speed"
            onValueChange={(value) => {
              void actions.setPlaybackRate(Number(value));
            }}
            value={String(state.playbackRate)}
          >
            {rates.map((rate) => (
              <Player.MenuRadioItem key={rate} value={rate}>
                {rate}&times;
              </Player.MenuRadioItem>
            ))}
          </Player.MenuRadioGroup>
        ) : null}
        {showQualities ? (
          <Player.MenuRadioGroup
            aria-label="Quality"
            onValueChange={(value) => {
              void actions.selectQuality(value === '' ? null : value);
            }}
            value={state.selectedQualityId ?? ''}
          >
            <Player.MenuRadioItem value="">
              {autoLabel(state.playing)}
            </Player.MenuRadioItem>
            {state.qualities.map((quality) => (
              <Player.MenuRadioItem key={quality.id} value={quality.id}>
                {qualityLabel(quality)}
              </Player.MenuRadioItem>
            ))}
          </Player.MenuRadioGroup>
        ) : null}
      </Player.SettingsMenuContent>
    </Player.SettingsMenu>
  );
};

export type ReferencePlayerProps = {
  readonly textTracks?: Player.MediaProps['textTracks'];
};

export const ReferencePlayer = ({
  textTracks
}: ReferencePlayerProps): ReactElement => {
  const state = Player.usePlayerState((snapshot) => ({
    playing: snapshot.playback === 'playing',
    muted: snapshot.muted,
    fullscreen: snapshot.fullscreen,
    pictureInPicture: snapshot.pictureInPicture
  }));

  return (
    <>
      <style>{layoutCss}</style>
      <Player.Viewport className="reely-example">
        <Player.Poster>
          <Player.PosterImage
            alt=""
            src="/poster.svg"
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        </Player.Poster>
        <Player.Media textTracks={textTracks} />
        <Player.LoadingIndicator />
        {/* The default child is a literal "Retry" text button; the example
            renders icons everywhere, so it supplies the render prop. */}
        <Player.ErrorDisplay className="reely-example-error">
          {({ error, retry }) => (
            <>
              <p>{error.message}</p>
              {retry ? (
                <button aria-label="Retry" onClick={retry} type="button">
                  <Player.ReplayIcon />
                </button>
              ) : null}
            </>
          )}
        </Player.ErrorDisplay>
        {/* Before Controls: Gestures is full-bleed with no z-index, so a later
            sibling without one would be covered by it. */}
        <Player.Gestures />
        <Player.ActivationButton>
          <Player.PlayIcon style={{ fontSize: '3rem' }} />
        </Player.ActivationButton>
        <Player.Controls
          aria-label="Video player controls"
          className="reely-example-controls"
        >
          <div className="reely-example-row">
            <Player.Time type="current" />
            <div className="reely-example-scrubber">
              <Player.SeekSlider />
            </div>
            <Player.Time type="duration" />
          </div>
          <div className="reely-example-row reely-example-row-buttons">
            <Player.PlayButton>
              {state.playing ? <Player.PauseIcon /> : <Player.PlayIcon />}
            </Player.PlayButton>
            <Player.MuteButton>
              {state.muted ? <Player.MutedIcon /> : <Player.VolumeHighIcon />}
            </Player.MuteButton>
            <Player.VolumeSlider className="reely-example-volume" />
            <span className="reely-example-spacer" />
            <Player.CaptionsButton>
              <Player.CaptionsIcon />
            </Player.CaptionsButton>
            {/* Default children: CaptionsMenu's own trigger already renders
                CaptionsIcon, not a text label. */}
            <Player.CaptionsMenu />
            <ExampleSettingsMenu />
            <Player.PipButton>
              {state.pictureInPicture ? (
                <Player.PipExitIcon />
              ) : (
                <Player.PipEnterIcon />
              )}
            </Player.PipButton>
            <Player.AirPlayButton>
              <Player.AirPlayIcon />
            </Player.AirPlayButton>
            <Player.FullscreenButton>
              {state.fullscreen ? (
                <Player.FullscreenExitIcon />
              ) : (
                <Player.FullscreenEnterIcon />
              )}
            </Player.FullscreenButton>
          </div>
        </Player.Controls>
        {/* After Controls, not before: Captions and Controls share z-index 20
            (#32), so the later sibling wins the tie. Captions used to lose it
            here, rendering caption text underneath the control bar. */}
        <Player.Captions />
      </Player.Viewport>
    </>
  );
};

const sources = [
  { id: 'mp4', label: 'MP4', source: '/tracer.mp4' },
  {
    id: 'hls',
    label: 'HLS',
    source: { type: 'hls', src: '/hls/master.m3u8' }
  },
  {
    id: 'youtube',
    label: 'YouTube',
    source: 'https://www.youtube.com/watch?v=M7lc1UVf-VE'
  },
  { id: 'vimeo', label: 'Vimeo', source: 'https://vimeo.com/76979871' }
] as const satisfies ReadonlyArray<{
  readonly id: string;
  readonly label: string;
  readonly source: Player.RootProps['source'];
}>;

// Only the local MP4 needs a declared <track>; HLS carries its subtitles in the
// manifest and the iframe providers expose their own. Declaring children on
// Media at all is the API #15 shipped without.
const mp4TextTracks: Player.MediaProps['textTracks'] = [
  {
    src: '/captions-en.vtt',
    srcLang: 'en',
    label: 'English',
    kind: 'captions',
    default: true
  }
];

/**
 * The same composition against four real providers, switched by swapping the
 * `source` prop rather than remounting `Player.Root` — the swap path is where
 * #15-class bugs live, so the reference example walks it.
 *
 * Capability gating becomes visible here rather than hidden: `AirPlayButton`
 * genuinely disappears on both YouTube and Vimeo, which hard-code `airPlay`
 * unavailable. `PipButton` disappears on YouTube only — Vimeo initialises
 * `pictureInPicture` available and downgrades it only if a request fails, so
 * the button renders there. That is the primitives' central promise on
 * display.
 */
export const ReferencePlayerWithSources = (): ReactElement => {
  const [active, setActive] = useState<(typeof sources)[number]['id']>('mp4');
  const current = sources.find((entry) => entry.id === active) ?? sources[0];

  return (
    <>
      <div
        aria-label="Source"
        role="group"
        style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}
      >
        {sources.map((entry) => (
          <button
            aria-pressed={entry.id === active}
            data-testid={`reference-source-${entry.id}`}
            key={entry.id}
            onClick={() => setActive(entry.id)}
            type="button"
          >
            {entry.label}
          </button>
        ))}
      </div>
      <Player.Root loading="interaction" source={current.source}>
        <ReferencePlayer
          textTracks={current.id === 'mp4' ? mp4TextTracks : undefined}
        />
      </Player.Root>
    </>
  );
};
