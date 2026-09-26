import * as Player from '@playdeck/react';
import {
  useEffect,
  useRef,
  type CSSProperties,
  type ReactElement
} from 'react';

/*
 * The streaming-service archetype: a long-form viewing layout.
 *
 * Named for the job, not for a company that does it — no logo, brand colour
 * or borrowed icon. The point is the shape, not the control list: one picture
 * that owns the screen and chrome that sits on top of it, versus
 * `examples/archetype-course-platform.tsx`'s studying layout, meant to be
 * told apart at a glance.
 *
 * Every control below is either a primitive that gates itself on a
 * capability or a block this file gates on one it read: a control whose
 * command cannot be honoured is absent rather than present and disabled.
 */

/*
 * The clip: the Sintel trailer, from the Blender Foundation's own download
 * host. CC-BY 3.0, credited in the note under the player and on every page
 * that mounts this file.
 *
 * Two containers rather than a bare URL, MP4 first: an engine without an
 * H.264 decoder falls through to the Theora file instead of failing source
 * selection outright — the same reasoning `stories/reference` uses for its
 * MP4-then-WebM pair.
 */
const sintelTrailer = {
  type: 'video',
  sources: [
    {
      src: 'https://download.blender.org/durian/trailer/sintel_trailer-720p.mp4',
      mimeType: 'video/mp4'
    },
    {
      src: 'https://download.blender.org/durian/trailer/sintel_trailer-720p.ogv',
      mimeType: 'video/ogg'
    }
  ]
} as const satisfies Player.RootProps['source'];

/*
 * The clip AND every word on screen that describes it, as one value —
 * overridable together through the `media` prop below, so a page that serves
 * its own clip (e.g. because it makes no third-party request) can replace it.
 *
 * One object rather than a prop per field because this file has already had
 * the bug: with only the source replaceable, a page pointed it at its own
 * test pattern and the title card kept announcing Sintel, CC-BY credit and
 * all, over colour bars. Bundled, the clip cannot change without its copy
 * changing with it.
 */
const sintel = {
  source: sintelTrailer,
  kicker: 'Short film',
  title: 'Sintel',
  blurb: 'A Blender Foundation open movie, played here from its own trailer.',
  credit: 'Sintel © Blender Foundation, licensed CC BY 3.0.'
} as const;

/*
 * The chapter list this layout offers when the provider has none of its own
 * (`useChapters` below prefers whatever the provider published). The titles
 * are fixture text marking time in the clip, not a description of the film —
 * the page says so under the player, because a demo that implied it had read
 * metadata it invented would be the one dishonest thing on a page about
 * honesty.
 */
const fallbackChapters = [
  { id: 'opening', title: 'Opening', startTime: 0 },
  { id: 'middle', title: 'Middle', startTime: 18 },
  { id: 'close', title: 'Close', startTime: 38 }
] as const;

type Segment = {
  readonly id: string;
  readonly title: string;
  readonly startTime: number;
};

/**
 * The chapters this layout will draw, and where they came from.
 *
 * `capabilities.chapters` is what separates a provider that cannot report
 * chapters from a source that simply has none — both publish an empty
 * collection — so the collection alone is not enough to branch on. Where the
 * provider does publish chapters they win outright: they are the title's own,
 * and a fixture standing in front of real metadata would be worse than no
 * fixture at all.
 */
const useChapters = (): {
  readonly segments: readonly Segment[];
  readonly fromProvider: boolean;
} => {
  const { chapters, status } = Player.usePlayerState((state) => ({
    chapters: state.chapters,
    status: state.capabilities.chapters.status
  }));
  return status === 'available' && chapters.length > 0
    ? { segments: chapters, fromProvider: true }
    : { segments: fallbackChapters, fromProvider: false };
};

const two = (value: number): string =>
  String(Math.floor(value)).padStart(2, '0');

/** `m:ss`, which is the whole of the arithmetic this example needs. */
const clock = (seconds: number): string =>
  `${Math.floor(seconds / 60)}:${two(seconds % 60)}`;

/**
 * The chapter rail: ticks laid over the scrubber, drawn inside
 * `Player.SeekSlider` so they share its box without this file measuring
 * anything. `aria-hidden` and not a focus target — the slider is already the
 * seek control and its `aria-valuetext` already says where the playhead is.
 * Chapter *navigation* is the course layout's job, done there with real
 * buttons. Nothing is drawn without a duration, or every tick lands on zero.
 */
const ChapterRail = ({
  segments
}: {
  readonly segments: readonly Segment[];
}): ReactElement | null => {
  const duration = Player.usePlayerState((state) => state.duration);
  if (duration === null || !(duration > 0)) return null;
  return (
    <span aria-hidden="true" className="stream-ticks">
      {segments
        .filter(
          (segment) => segment.startTime > 0 && segment.startTime < duration
        )
        .map((segment) => (
          <span
            className="stream-tick"
            key={segment.id}
            style={{
              insetInlineStart: `${(segment.startTime / duration) * 100}%`
            }}
          />
        ))}
    </span>
  );
};

/** The chapter the playhead is inside, by name, or null before there is one. */
const CurrentChapter = ({
  segments
}: {
  readonly segments: readonly Segment[];
}): ReactElement | null => {
  const currentTime = Player.usePlayerState((state) => state.currentTime);
  const active = [...segments]
    .reverse()
    .find((segment) => currentTime >= segment.startTime);
  if (active === undefined) return null;
  return <span className="stream-chapter">{active.title}</span>;
};

/**
 * What the captions are actually being drawn by, printed rather than assumed.
 *
 * `captionRendering` is the library's answer to a question a consumer cannot
 * ask the browser directly: `custom` means this composition's own
 * `Player.Captions` overlay is painting the cues, `native` means the media
 * element's own renderer is, `provider` means a third-party player is, and
 * `unavailable` means nothing is. A streaming layout has to show the viewer
 * that captions are on; showing which renderer honoured that is what makes the
 * claim checkable rather than decorative.
 *
 * It is a readout and not a control. Nothing here calls `setCaptionRenderer` —
 * `Player.CaptionsButton` beside it owns the on/off, and it gates itself on
 * `selectTextTrack`.
 */
const CaptionMode = (): ReactElement => {
  const rendering = Player.usePlayerState((state) => state.captionRendering);
  return (
    <span className="stream-mode" data-mode={rendering}>
      <span className="stream-mode__label">captions</span>
      <span className="stream-mode__value">{rendering}</span>
    </span>
  );
};

const PlayGlyph = (): ReactElement => (
  <svg
    aria-hidden="true"
    className="stream-glyph"
    fill="currentColor"
    viewBox="0 0 24 24"
  >
    <path d="M8 5.2v13.6L19 12z" />
  </svg>
);

/*
 * An original mark for the resume affordance: an arc returning on itself over
 * the play triangle. Drawn here rather than taken from the library's icon set,
 * because the library ships no "resume" icon and the alternative — reusing
 * `ReplayIcon`, which means start again — would label the button with the
 * opposite of what it does.
 */
const ResumeGlyph = (): ReactElement => (
  <svg
    aria-hidden="true"
    className="stream-glyph"
    fill="none"
    stroke="currentColor"
    strokeLinecap="round"
    strokeWidth="1.8"
    viewBox="0 0 24 24"
  >
    <path d="M4 12a8 8 0 1 0 2.4-5.7" />
    <path d="M3.4 4.6v3.2h3.2" />
    <path d="M10.5 9.2v5.6L15.5 12z" fill="currentColor" stroke="none" />
  </svg>
);

/*
 * Undoes `ActivationButton`'s full-bleed overlay style (`position`, `inset`,
 * `margin`, `z-index` — see `loading-error.tsx`), which no stylesheet rule can
 * outrank, so both buttons sit in normal flow instead. `margin: 0` matters
 * here specifically: once this box is a flex item, an auto margin absorbs the
 * free space in its line and pushes the two buttons apart.
 */
const inFlow: CSSProperties = {
  position: 'static',
  inset: 'auto',
  margin: 0,
  zIndex: 'auto'
};

export type StreamingServicePlayerProps = {
  /**
   * A same-origin WebVTT captions file. It arrives as a prop because each
   * surface serves its own copy from its own base path, which is the one thing
   * about this composition that Storybook and the site cannot answer the same
   * way. Everything else — the clip, the chapters, the layout — is this file's.
   */
  readonly captionsSrc: string;
  /**
   * Where this viewer stopped last time, in seconds, or `null` for someone who
   * has not watched it. A real service reads this from an account; the example
   * takes it as a prop so both surfaces can stage the affordance without this
   * file inventing a persistence layer it would then have to defend.
   */
  readonly resumeAt?: number | null;
  /**
   * What to play, and what the layout says about it — `source` the clip,
   * `kicker`/`title`/`blurb` the title card, `credit` the attribution line
   * (see `sintel` for why the five travel together). Defaults to the trailer
   * above, so a consumer who passes nothing gets the whole archetype from
   * one paste.
   *
   * The chapter fixture above is spaced for a clip roughly the trailer's
   * length; `ChapterRail` draws only marks inside the duration, so a shorter
   * source silently loses marks past its last frame.
   */
  readonly media?: {
    readonly source: Player.RootProps['source'];
    readonly kicker: string;
    readonly title: string;
    readonly blurb: string;
    readonly credit: string;
  };
};

/**
 * The archetype: the composition, the clip it is pointed at, and the loading
 * strategy that holds it dormant. This is what a page mounts.
 *
 * `loading="interaction"`: nothing is fetched and no provider is attached
 * until the viewer presses one of the two affordances on the title card, so a
 * page carrying this player makes no media request until asked for one.
 */
export const StreamingServicePlayer = ({
  captionsSrc,
  media = sintel,
  resumeAt = null
}: StreamingServicePlayerProps): ReactElement => (
  <Player.Root loading="interaction" source={media.source}>
    <StreamingServiceSurface
      captionsSrc={captionsSrc}
      media={media}
      resumeAt={resumeAt}
    />
  </Player.Root>
);

/**
 * Everything inside `Player.Root` — separable because every hook below reads
 * the player, and a hook can only reach one from inside the root.
 *
 * Exported so a workbench story can supply its own root and dial the
 * capabilities in, the only way to see the whole control surface with no
 * media and no network (`stories/reference` splits itself the same way). It
 * reads every field of `media` except `source`, which the root above mounts —
 * see the comment on `sintel` for why the two travel together.
 */
export const StreamingServiceSurface = ({
  captionsSrc,
  media = sintel,
  resumeAt = null
}: StreamingServicePlayerProps): ReactElement => {
  const state = Player.usePlayerState((snapshot) => ({
    activation: snapshot.activation,
    commandsReady: snapshot.commandsReady,
    errored: snapshot.error !== null,
    playing: snapshot.playback === 'playing',
    muted: snapshot.muted,
    fullscreen: snapshot.fullscreen,
    pictureInPicture: snapshot.pictureInPicture
  }));
  const actions = Player.usePlayerActions();
  const { segments, fromProvider } = useChapters();

  /*
   * The resume decision, carried from the press to the moment there is a
   * player to act on. A ref rather than state: nothing renders from it, and
   * the affordance that writes it unmounts the instant the player is ready.
   * The effect clears the flag so a later source swap cannot silently seek
   * somewhere nobody asked for.
   *
   * Gated on `commandsReady` rather than `activation === 'ready'`: the latter
   * only means there is a picture, and a seek issued right there can land on
   * an element a queued `load()` is about to empty. `commandsReady` is the
   * provider's signal that a command now will stick (`PlayerState.commandsReady`,
   * `packages/core/src/types.ts`) — gating on it is what keeps the resume
   * position from being silently lost (#551).
   */
  const resumeRequested = useRef(false);
  const ready = state.activation === 'ready';
  useEffect(() => {
    if (!state.commandsReady || !resumeRequested.current || resumeAt === null)
      return;
    resumeRequested.current = false;
    void actions.seekTo(resumeAt);
  }, [actions, state.commandsReady, resumeAt]);

  /*
   * `ActivationButton` before activation, `ErrorDisplay` while an error
   * stands — either owns the picture and would leave the bar beneath it
   * invisible but still tabbable and announced (WCAG 2.2 SC 2.4.11), so
   * `hidden` takes it out of layout and the accessibility tree instead.
   */
  const overlayOwnsPicture = !ready || state.errored;

  return (
    <>
      <style>{streamingCss}</style>
      <section aria-label="Feature" className="stream">
        <Player.Viewport className="stream-stage">
          <Player.Media
            className="stream-media"
            textTracks={[
              {
                src: captionsSrc,
                srcLang: 'en',
                label: 'English',
                kind: 'captions',
                default: true
              }
            ]}
          />
          <Player.LoadingIndicator className="stream-loading" />
          <Player.ErrorDisplay className="stream-error">
            {({ error, retry }) => (
              <>
                <p>{error.message}</p>
                {retry ? (
                  <button
                    className="stream-retry"
                    onClick={retry}
                    type="button"
                  >
                    Try again
                  </button>
                ) : null}
              </>
            )}
          </Player.ErrorDisplay>

          {/* Before `Player.Controls`, and that order is the whole of it:
              `Player.Gestures` is full-bleed and takes no `z-index`, so among
              positioned siblings at the same level the LATER one paints on top.
              Put after the bar it would cover the bar and swallow its clicks;
              put here, every interactive layer below stays above it. */}
          <Player.Gestures />

          {/* One absolutely positioned layer holding text plus both
              activation affordances, rather than a layer per element, so the
              whole dormant state lifts away in one move once the player is
              ready and both buttons unmount themselves. */}
          <div className="stream-intro" hidden={ready}>
            <p className="stream-kicker">{media.kicker}</p>
            <h2 className="stream-title">{media.title}</h2>
            <p className="stream-blurb">{media.blurb}</p>
            <div className="stream-actions">
              {resumeAt === null ? null : (
                <Player.ActivationButton
                  aria-label={`Resume from ${clock(resumeAt)}`}
                  className="stream-primary"
                  onClick={() => {
                    resumeRequested.current = true;
                  }}
                  style={inFlow}
                >
                  <ResumeGlyph />
                  Resume from {clock(resumeAt)}
                </Player.ActivationButton>
              )}
              <Player.ActivationButton
                aria-label="Play from the beginning"
                className={
                  resumeAt === null ? 'stream-primary' : 'stream-secondary'
                }
                onClick={() => {
                  resumeRequested.current = false;
                }}
                style={inFlow}
              >
                <PlayGlyph />
                {resumeAt === null ? 'Play' : 'From the beginning'}
              </Player.ActivationButton>
            </div>
          </div>

          <Player.Controls
            aria-label="Feature player controls"
            className="stream-bar"
            hidden={overlayOwnsPicture}
          >
            <div className="stream-scrub">
              <Player.Time className="stream-time" type="current" />
              <Player.SeekSlider className="stream-seek">
                <ChapterRail segments={segments} />
              </Player.SeekSlider>
              <Player.Time className="stream-time" type="remaining" />
            </div>
            <div className="stream-buttons">
              <Player.PlayButton className="stream-chip">
                {state.playing ? <Player.PauseIcon /> : <Player.PlayIcon />}
              </Player.PlayButton>
              <Player.MuteButton className="stream-chip">
                {state.muted ? <Player.MutedIcon /> : <Player.VolumeHighIcon />}
              </Player.MuteButton>
              <Player.VolumeSlider className="stream-volume" />
              <CurrentChapter segments={segments} />
              <span className="stream-spacer" />
              <CaptionMode />
              <Player.CaptionsButton className="stream-chip">
                <Player.CaptionsIcon />
              </Player.CaptionsButton>
              {/* The library's own preset: gates the trigger on
                  `selectQuality` and the Auto row separately on
                  `selectQualityAuto` (`packages/react/src/quality.tsx`) — a
                  local reimplementation of this once gated Auto on
                  `selectQuality` alone, which rendered it even where a
                  provider (e.g. `@playdeck/provider-vimeo`) accepts a rung
                  but refuses `selectQuality(null)`. Rate control has no
                  equivalent here: it belongs to
                  `examples/archetype-course-platform.tsx`, and offering it
                  here would blur the one line between the two files.
                  Styled through `data-playdeck-part`, like the file's other
                  parts, rather than a className prop. */}
              <Player.QualityMenu />
              <Player.PipButton className="stream-chip">
                {state.pictureInPicture ? (
                  <Player.PipExitIcon />
                ) : (
                  <Player.PipEnterIcon />
                )}
              </Player.PipButton>
              <Player.AirPlayButton className="stream-chip">
                <Player.AirPlayIcon />
              </Player.AirPlayButton>
              <Player.FullscreenButton className="stream-chip">
                {state.fullscreen ? (
                  <Player.FullscreenExitIcon />
                ) : (
                  <Player.FullscreenEnterIcon />
                )}
              </Player.FullscreenButton>
            </div>
          </Player.Controls>

          {/* After `Player.Controls`, not before: both take the same stacking
              level, so the later sibling wins the tie and cue text is drawn
              above the bar rather than under it. Hidden under the same
              condition, because cue text below an opaque error surface is
              unreadable. */}
          <Player.Captions
            className="stream-captions"
            hidden={overlayOwnsPicture}
          />
        </Player.Viewport>

        <p className="stream-note">
          {fromProvider
            ? 'Chapter marks come from the provider.'
            : 'Chapter marks and caption text are fixtures this example ships. They mark time in the clip; they do not describe what is playing.'}{' '}
          {media.credit}
        </p>
      </section>
    </>
  );
};

/*
 * The archetype's appearance, inline: a `<style>` element rather than an
 * imported stylesheet, both because the `examples` TypeScript project knows
 * nothing about CSS imports and so a consumer copying this file gets the
 * whole archetype in one paste.
 *
 * Container queries rather than viewport media queries, because this player
 * is embedded in a page whose column width is not the window's.
 *
 * One template literal, so a backtick anywhere inside — including
 * code-quoting in a comment — closes the string early. The comments below use
 * no quoting for that reason.
 */
const streamingCss = `
/* One dark panel, its own ground rather than the host page's: the credit
   line below the stage is set in the same light-on-dark scale as the chrome
   above it, and read against whatever the page happens to be its contrast
   would be unverifiable. */
.stream {
  container-type: inline-size;
  display: grid;
  gap: 0.75rem;
  width: 100%;
  padding: 0.75rem;
  border-radius: 0.9rem;
  background-color: #0c0b10;
  color: #ece9f5;
  font-family: ui-sans-serif, system-ui, sans-serif;
}
.stream-stage {
  position: relative;
  width: 100%;
  aspect-ratio: var(--playdeck-media-aspect-ratio, 16 / 9);
  overflow: hidden;
  border-radius: 0.75rem;
  background-color: #0c0b10;
}
.stream [hidden] {
  display: none !important;
}
.stream-media {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
/* The dormant state: a title card, not a poster. Nothing has loaded, so there
   is no frame to show and this layout may not invent one — no still, no
   gradient standing in for a picture. What it can do is read as a title a
   service is offering, which is what the copy and the two affordances are. */
.stream-intro {
  position: absolute;
  inset: 0;
  z-index: 30;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: 0.4rem;
  padding: clamp(1rem, 4cqw, 2.5rem);
  background-color: #0c0b10;
}
.stream-kicker {
  margin: 0;
  color: #9d97c4;
  font-size: 0.75rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.stream-title {
  margin: 0;
  font-size: clamp(1.75rem, 7cqw, 3.5rem);
  font-weight: 600;
  letter-spacing: -0.02em;
  line-height: 1.05;
}
.stream-blurb {
  margin: 0;
  max-width: 34ch;
  color: #b6b1d0;
  font-size: 0.9375rem;
}
.stream-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.75rem;
}
/* Real ActivationButtons, so Tab/Enter/Space work with no handler of this
   file's; only size and colour are set here (positioning is undone via
   inFlow at the point of use). The --playdeck-activation-fill/-border
   custom properties are set alongside the plain background/border they
   duplicate because the button also writes those two as an inline style
   (loading-error.tsx), which outranks anything set here otherwise. */
.stream-primary,
.stream-secondary {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  min-height: 2.75rem;
  padding: 0 1.1rem;
  border: 1px solid transparent;
  border-radius: 999px;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.stream-primary {
  --playdeck-activation-fill: #ece9f5;
  --playdeck-activation-border: 0;
  background-color: #ece9f5;
  color: #14121c;
}
.stream-secondary {
  --playdeck-activation-fill: rgb(236 233 245 / 0.12);
  --playdeck-activation-border: 1px solid rgb(236 233 245 / 0.4);
  background-color: rgb(236 233 245 / 0.12);
  border-color: rgb(236 233 245 / 0.4);
  color: #ece9f5;
}
.stream-glyph {
  width: 1.15rem;
  height: 1.15rem;
}
/* The control bar. It sits ON the picture, which is the whole of this
   archetype's posture: the film is the page, and the chrome is a guest on it.
   The course layout below docks the same commands under the picture instead,
   and that single difference is most of what tells the two apart. */
.stream-bar {
  position: absolute;
  inset: auto 0 0 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding: 0.5rem 0.75rem 0.6rem;
  background-color: rgb(8 7 12 / 0.92);
}
.stream-scrub,
.stream-buttons {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}
.stream-buttons {
  flex-wrap: wrap;
}
.stream-seek {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
}
.stream [data-playdeck-part='seek-slider-input'],
.stream [data-playdeck-part='volume-slider'] {
  accent-color: #a89ff0;
  background-color: transparent;
  cursor: pointer;
}
/* Removing the line box, so the slider's container is the input's own 44px
   target and nothing sits inside it off-centre. A range input is inline-level,
   so left alone the container grows past it by the descender space under the
   baseline. */
.stream [data-playdeck-part='seek-slider-input'] {
  display: block;
}
.stream [data-playdeck-part='seek-buffered'] {
  position: absolute;
  inset-inline: 0;
  inset-block-start: 50%;
  block-size: 0.25rem;
  translate: 0 -50%;
  border-radius: 0.125rem;
  background-color: rgb(236 233 245 / 0.2);
  /* The layer describes the control beneath it and must not swallow the seek
     it describes: an absolutely positioned box paints above its statically
     positioned sibling whatever the DOM order. */
  pointer-events: none;
}
.stream [data-playdeck-part='seek-buffered-range'] {
  inset-block: 0;
  border-radius: inherit;
  background-color: rgb(236 233 245 / 0.42);
}
.stream [data-playdeck-part='seek-progress'] {
  inset-block: 0;
  border-radius: inherit;
  background-color: #a89ff0;
}
/* The chapter ticks, laid over the same 4px band the buffered layer occupies
   and centred on it. Each is placed by a percentage this file computes from the
   duration, because CSS has no way to ask where a second on the timeline is. */
.stream-ticks {
  position: absolute;
  inset-inline: 0;
  inset-block-start: 50%;
  height: 0.25rem;
  translate: 0 -50%;
  pointer-events: none;
}
.stream-tick {
  position: absolute;
  inset-block: 0;
  width: 2px;
  translate: -1px 0;
  background-color: #0c0b10;
}
.stream-chapter {
  overflow: hidden;
  max-width: 14ch;
  color: #b6b1d0;
  font-size: 0.8125rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.stream-time {
  flex: 0 0 auto;
  color: #cdc8e2;
  font-size: 0.8125rem;
  font-variant-numeric: tabular-nums;
}
.stream-spacer {
  flex: 1 1 auto;
}
.stream-chip,
.stream [data-playdeck-part='settings-menu-trigger'] {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  min-width: 2.75rem;
  min-height: 2.75rem;
  padding: 0;
  border: none;
  border-radius: 0.5rem;
  background-color: transparent;
  color: inherit;
  cursor: pointer;
}
.stream-chip:hover,
.stream [data-playdeck-part='settings-menu-trigger']:hover {
  background-color: rgb(236 233 245 / 0.14);
}
.stream-volume {
  flex: 0 0 auto;
  inline-size: 5rem;
}
/* The renderer is spelled out as a word, so the readout carries itself; the
   colour below is an accelerator on top of it, never the only carrier. */
.stream-mode {
  display: inline-flex;
  gap: 0.35rem;
  align-items: baseline;
  padding: 0.2rem 0.5rem;
  border-radius: 0.375rem;
  background-color: rgb(236 233 245 / 0.08);
  font-size: 0.6875rem;
  letter-spacing: 0.02em;
}
.stream-mode__label {
  color: #8f89b4;
}
.stream-mode__value {
  color: #cdc8e2;
  font-weight: 600;
}
.stream-mode[data-mode='unavailable'] .stream-mode__value {
  color: #f19bb2;
}
.stream [data-playdeck-part='settings-menu'] {
  position: absolute;
  right: 0;
  bottom: calc(100% + 0.4rem);
  z-index: 25;
  display: flex;
  flex-direction: column;
  min-width: 11rem;
  max-height: 12rem;
  overflow-y: auto;
  padding: 0.25rem;
  border: 1px solid rgb(236 233 245 / 0.16);
  border-radius: 0.5rem;
  background-color: #16141f;
}
.stream [data-playdeck-part='menu-radio-item'] {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  justify-content: flex-start;
  min-height: 2.25rem;
  padding: 0 0.5rem;
  border: none;
  border-radius: 0.375rem;
  background-color: transparent;
  color: inherit;
  font: inherit;
  font-size: 0.875rem;
  text-align: left;
  cursor: pointer;
}
.stream [data-playdeck-part='menu-radio-item']:hover,
.stream [data-playdeck-part='menu-radio-item'][aria-checked='true'] {
  background-color: rgb(236 233 245 / 0.12);
}
.stream-captions {
  position: absolute;
  inset: auto 0 5.5rem 0;
  z-index: 20;
  justify-content: center;
  padding: 0 1rem;
  text-align: center;
}
.stream-loading {
  position: absolute;
  inset-inline: 0;
  inset-block-start: 0.75rem;
  z-index: 25;
  color: #cdc8e2;
  font-size: 0.8125rem;
  text-align: center;
  pointer-events: none;
}
.stream-error {
  position: absolute;
  inset: 0;
  z-index: 40;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background-color: #0c0b10;
  text-align: center;
}
.stream-retry {
  min-height: 2.75rem;
  padding: 0 1.1rem;
  border: 1px solid rgb(236 233 245 / 0.4);
  border-radius: 999px;
  background-color: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.stream-note {
  margin: 0;
  color: #8f89b4;
  font-size: 0.75rem;
  line-height: 1.5;
}
/* Below this width, two things go rather than wrap. The chapter name is a
   readout and costs nothing to drop; the volume slider is a real control and
   dropping it does cost something — named here rather than claimed free —
   but the mute button that stays answers the more common case, and a 5rem
   slider is a poor use of the room a narrow bar has. */
@container (max-width: 30rem) {
  .stream-volume,
  .stream-chapter {
    display: none;
  }
  .stream-captions {
    inset-block-end: 7rem;
  }
}
@media (prefers-reduced-motion: no-preference) {
  .stream-chip,
  .stream-primary,
  .stream-secondary,
  .stream [data-playdeck-part='settings-menu-trigger'] {
    transition: background-color 120ms ease;
  }
}
`;
