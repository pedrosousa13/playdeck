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
/* This whole block is one JS template literal (it is delimited by the
   backtick right above). Do not put a backtick anywhere in here, including
   markdown-style code-quoting in a comment - it silently closes the string
   early and breaks the build with no warning at this line. */
/* Controls that depend on how much room the PLAYER has query this, not the
   viewport: an embedded player in a narrow column then gets the same
   treatment as a narrow phone, which a viewport media query cannot express.

   The container is this wrapper, not the player. An element is never matched
   by its own container query, so with container-type on .reely-example the box
   could not restyle itself — which is how aspect-ratio ended up stranded on a
   viewport media query while the rules it is paired with fired on the
   container (#114). The cqw unit below needs an ancestor container for the
   same reason. max-width lives here so container width and player width are
   the same number at every viewport; on the player it would leave the
   container measuring the full page above 768px. */
.reely-example-frame {
  width: 100%;
  max-width: 48rem;
  container-type: inline-size;
}
.reely-example {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  background: #0b0e13;
  color: #e8edf4;
  font-family: system-ui, sans-serif;
}
/* The standard [hidden] reset, and it needs !important here rather than by
   habit: reely's overlay primitives carry their own inline display (Captions
   is display: flex from captionsOverlayStyle), and a non-important stylesheet
   rule cannot beat an inline one. Without this, hidden is inert on exactly
   the parts #89 needs it on. */
.reely-example [hidden] {
  display: none !important;
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
.reely-example-menu [data-reely-part='menu-radio-item'],
.reely-example-menu [data-reely-part='menu-item'] {
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
  /* Opaque, not 0.86 alpha: the same axe color-contrast issue as the control
     bar (#32) — a background that isn't fully opaque over the poster image
     leaves a single background color unresolvable (messageKey: imgNode). */
  background: rgb(4, 6, 10);
  text-align: center;
  padding: 1rem;
}
/* Below this width the button row alone needs the space. Dropping the volume
   slider (rather than letting it squeeze) is what keeps the composition usable
   at 320px, so #32's 1.4.10 reflow check passes by construction. The mute
   button survives it, so no function is lost — which is why PiP and AirPlay
   move into the settings menu instead of being hidden like this.

   min-height, not aspect-ratio. The row stops being an overlay here: at 320px
   with text resized to 200% (#32's 1.4.4 check) it is taller than a 16:9 box,
   and an absolutely-positioned row inside an overflow: hidden box is clipped —
   measured at 35px of lost controls. But aspect-ratio: auto is the wrong
   release valve: Poster and Media are absolutely positioned and contribute no
   in-flow height, so with the row in flow as the only in-flow child the box
   collapses onto the row itself — measured 288x153 at a 320px viewport, a
   player with no video area at all. A 9/16 floor in container units keeps the
   box 16:9 until the row genuinely needs more, and lets it grow when it does.

   justify-content: flex-end pins the row to the bottom. Without it the row
   sits at the TOP of a min-height-inflated box, because it is the only in-flow
   child and the extra height is trailing free space.

   relative, not static: the row still needs to take up space in normal
   flow (that's the fix), but static also drops it out of the positioned
   stacking context its z-index: 20 relies on, so it silently painted BELOW
   Gestures/Poster/Media instead of above them — invisible and unclickable,
   confirmed by elementFromPoint at the row's own center resolving to the
   gestures element instead. relative keeps the same in-flow position — the
   inherited inset: auto 0 0 0 nets to zero displacement on a
   relatively-positioned box — while keeping z-index effective.

   No :has(.reely-example-controls[hidden]) guard any more. It existed because
   aspect-ratio: auto collapsed the box to zero height in the states where #89
   hides the row (pre-activation, and while an error surface owns the
   viewport), taking the full-bleed overlay down with it — measured as an
   activation button that could not be clicked. min-height holds the box open
   in exactly those states, so there is nothing left to guard. */
@container (max-width: 420px) {
  .reely-example {
    aspect-ratio: auto;
    min-height: 56.25cqw;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
  }
  .reely-example-controls {
    position: relative;
  }
  .reely-example-volume {
    display: none;
  }
  .reely-example-fold {
    display: none;
  }
}
/* The other half of the fold. Both forms are always rendered and the container
   query hides whichever does not apply — display: none takes the inactive one
   out of the accessibility tree too, so neither width offers the same action
   twice. 421px, not 420px: the breakpoint above is inclusive.

   Written as a descendant selector to match the specificity of the menu item
   styling above, which sets display: flex at (0,2,0). A bare
   .reely-example-menu-fold is (0,1,0) and silently loses to it — measured, as
   a PiP entry that stayed visible next to the PiP button at 768px. */
@container (min-width: 421px) {
  .reely-example-menu .reely-example-menu-fold {
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
    playing: snapshot.quality,
    pictureInPicture: snapshot.pictureInPicture,
    pipStatus: snapshot.capabilities.pictureInPicture.status,
    airPlayStatus: snapshot.capabilities.airPlay.status
  }));
  const actions = Player.usePlayerActions();
  const showRates = state.rateStatus === 'available';
  const showQualities =
    state.qualityStatus === 'available' && state.qualities.length > 0;
  // The folded entries (#114). MenuItem does not gate itself the way PipButton
  // and AirPlayButton do, so these read the same capabilities the buttons read.
  // The menu must also open when the folded entries are the ONLY thing in it,
  // or the functionality it absorbed disappears exactly where it is needed.
  const showPip = state.pipStatus === 'available';
  const showAirPlay = state.airPlayStatus === 'available';
  if (!showRates && !showQualities && !showPip && !showAirPlay) return null;

  return (
    <Player.SettingsMenu>
      <Player.SettingsMenuTrigger>
        <Player.SettingsIcon />
      </Player.SettingsMenuTrigger>
      <Player.SettingsMenuContent className="reely-example-menu">
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
        {/* Folded out of the button row below 420px (#114). These two carry
            visible text rather than an icon alone: they are menu entries, and
            the accessible name of a menuitem comes from its content — there is
            no primitive supplying an aria-label here the way there is for the
            buttons. */}
        {showPip ? (
          <Player.MenuItem
            className="reely-example-menu-fold"
            onSelect={() => {
              void (state.pictureInPicture
                ? actions.exitPictureInPicture()
                : actions.requestPictureInPicture());
            }}
          >
            {state.pictureInPicture ? (
              <Player.PipExitIcon />
            ) : (
              <Player.PipEnterIcon />
            )}
            Picture in picture
          </Player.MenuItem>
        ) : null}
        {showAirPlay ? (
          <Player.MenuItem
            className="reely-example-menu-fold"
            onSelect={() => {
              void actions.showAirPlayPicker();
            }}
          >
            <Player.AirPlayIcon />
            AirPlay
          </Player.MenuItem>
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
    pictureInPicture: snapshot.pictureInPicture,
    activation: snapshot.activation,
    errored: snapshot.error !== null
  }));
  // #89. A full-bleed, pointer-capturing overlay owns the viewport in exactly
  // two situations: `ActivationButton` before activation (a real button at
  // `inset: 0; z-index: 30`) and `ErrorDisplay` while an error exists (an
  // opaque surface at 40). Content underneath one of them is invisible and
  // unclickable but still tabbable and still announced, which is WCAG 2.2
  // SC 2.4.11 — so the layer below is taken out of the page entirely.
  //
  // Both conditions are the negations of the overlays' own render gates, so
  // this cannot drift out of sync with them. `LoadingIndicator` is excluded
  // on purpose: it sets `pointer-events: none`, so controls beneath it stay
  // operable.
  //
  // `hidden`, not a conditional render, on its own merits: it removes the row
  // from layout, from the a11y tree and from the tab order — all SC 2.4.11
  // asks for — without paying to unmount and remount the whole subtree.
  //
  // It used to be load-bearing for a second reason. A control mounted after
  // the state it selects had already advanced could miss one notification and
  // render stale (measured on WebKit as a captions button stuck reading `on`,
  // 6 runs of 6), so a conditional render here tripped it. That was #95 — one
  // throwing subscriber abandoning the controller's emit loop — and it is
  // fixed in core, so either shape is correct now.
  const overlayOwnsViewport = state.activation !== 'ready' || state.errored;

  return (
    <>
      <style>{layoutCss}</style>
      <div className="reely-example-frame">
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
            hidden={overlayOwnsViewport}
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
              <Player.PipButton className="reely-example-fold">
                {state.pictureInPicture ? (
                  <Player.PipExitIcon />
                ) : (
                  <Player.PipEnterIcon />
                )}
              </Player.PipButton>
              <Player.AirPlayButton className="reely-example-fold">
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
              here, rendering caption text underneath the control bar. Hidden
              under the same condition as Controls: cue text below an opaque
              error surface is unreadable, and leaves the same
              unresolvable-background residue the control row did. */}
          <Player.Captions hidden={overlayOwnsViewport} />
        </Player.Viewport>
      </div>
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
//
// `captions-reference.vtt`, not `captions-en.vtt`: this example's own fixture
// carries two cues with a boundary at 0.4s, inside the ~1s clip, so a cue
// transition actually happens during real playback here (#32's e2e
// announcement-policy test needs one to fall inside its observation window).
// `captions-en.vtt` stays a single 0-5s cue for the other stories/specs that
// use it (`fixtures-playerfixture--captions-*`, driven by
// `e2e/captions.spec.ts`) — this file is scoped to the reference example only.
const mp4TextTracks: Player.MediaProps['textTracks'] = [
  {
    src: '/captions-reference.vtt',
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
