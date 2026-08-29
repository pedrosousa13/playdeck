import * as Player from '@playdeck/react';
import {
  useEffect,
  useRef,
  type CSSProperties,
  type ReactElement
} from 'react';

/*
 * The course-platform archetype: a layout for studying rather than watching.
 *
 * Named for the job, like its sibling, and for the same reason — a demo
 * labelled with a company's name makes a claim about a brand nobody here owns
 * and goes stale the day that company redesigns. No logo, no company name, no
 * brand colour, and the two glyphs below are drawn in this file.
 *
 * ---- what makes this the OTHER archetype ------------------------------------
 *
 * `examples/archetype-streaming-service.tsx` is the same primitives arranged
 * for someone who has sat down in front of a film. Four differences are
 * structural rather than cosmetic, and they are the whole reason both files
 * exist:
 *
 * 1. **The video is not the only thing on screen.** This is a two-column study
 *    page — the lesson beside the picture, not under it and not behind it —
 *    and the picture gives up width to make room for it.
 * 2. **The chrome is docked, not overlaid.** The transport sits under the
 *    picture in normal flow, so nothing ever covers what is being studied and
 *    nothing has to auto-hide. The streaming layout puts the same commands on
 *    top of the picture, which is the posture of a film.
 * 3. **Speed is a first-class control.** Somebody studying changes rate
 *    constantly and should not open a menu to do it, so the rates are a visible
 *    segmented group. The streaming layout does not offer the command at all:
 *    a viewer watching a film has no use for it, and giving it to both files
 *    would blur the one line this pair exists to draw.
 * 4. **Navigation is by outline.** Real buttons that seek to a section, with
 *    the one being played marked. The streaming layout draws its chapters as
 *    ticks on the scrubber — a hint while scrubbing, not a way to get around.
 *
 * If those four were removed this would be the first archetype with different
 * colours, which is the one thing it must not be.
 */

/*
 * The clip. The Big Buck Bunny trailer, from the Blender Foundation's own
 * download host, standing in for a lesson recording. CC-BY 3.0, credited under
 * the player and on every page that mounts this file.
 *
 * Two containers, and the ordering is load-bearing rather than tidy: the first
 * is an MPEG-4 file the host serves as `video/x-m4v`, which not every engine
 * accepts, and the Theora file behind it is what those engines take instead of
 * failing source selection outright. Declaring a `<source>` set is the API for
 * saying that; a bare URL string would offer one candidate and some engines
 * would have nothing to fall back to.
 */
const bigBuckBunnyTrailer = {
  type: 'video',
  sources: [
    {
      src: 'https://download.blender.org/peach/trailer/trailer_iphone.m4v',
      mimeType: 'video/mp4'
    },
    {
      src: 'https://download.blender.org/peach/trailer/trailer_400p.ogg',
      mimeType: 'video/ogg'
    }
  ]
} as const satisfies Player.RootProps['source'];

/*
 * The lesson outline.
 *
 * It is the course's own data and deliberately not read from the media. A
 * course platform knows its structure because it authored it — the sections
 * exist in the syllabus before anybody records anything — so this is a prop of
 * the lesson rather than metadata this layout goes looking for. The streaming
 * archetype does the opposite, preferring whatever chapters the provider
 * publishes, and the difference is real: one is a document's structure, the
 * other is a title's.
 *
 * The titles below are the example's own fixture text. They mark time in the
 * clip and make no claim about the film, which the note under the player says
 * outright.
 *
 * The times are spaced to land inside the trailer above, which is a short one —
 * a section that started after the last frame would be a button that seeks to
 * the end and a step of the progress readout nobody could ever reach. Pointing
 * this composition at a longer recording means respacing these, and that is the
 * cost of an outline being the course's data rather than the media's.
 */
const outline = [
  { id: 's1', title: 'Introduction', startTime: 0 },
  { id: 's2', title: 'Part one', startTime: 7 },
  { id: 's3', title: 'Part two', startTime: 14 },
  { id: 's4', title: 'Part three', startTime: 21 },
  { id: 's5', title: 'Wrap-up', startTime: 28 }
] as const;

const two = (value: number): string =>
  String(Math.floor(value)).padStart(2, '0');

/** `m:ss`, which is the whole of the arithmetic this example needs. */
const clock = (seconds: number): string =>
  `${Math.floor(seconds / 60)}:${two(seconds % 60)}`;

/** The rungs a person studying actually reaches for. */
const rates = [0.75, 1, 1.25, 1.5, 2] as const;

/*
 * A bracket opening to the right: the mark this layout uses for "outline".
 * Drawn here because the library ships no such icon and there is no borrowed
 * glyph to reach for.
 */
const OutlineGlyph = (): ReactElement => (
  <svg
    aria-hidden="true"
    className="study-glyph"
    fill="none"
    stroke="currentColor"
    strokeLinecap="round"
    strokeWidth="1.6"
    viewBox="0 0 24 24"
  >
    <path d="M5 5.5h14M5 12h9M5 18.5h11" />
  </svg>
);

/*
 * The resume mark: an arc returning on itself. Same idea as the streaming
 * archetype's, drawn separately because each example is one paste for a
 * consumer and neither may import from the other.
 */
const ResumeGlyph = (): ReactElement => (
  <svg
    aria-hidden="true"
    className="study-glyph"
    fill="none"
    stroke="currentColor"
    strokeLinecap="round"
    strokeWidth="1.7"
    viewBox="0 0 24 24"
  >
    <path d="M4 12a8 8 0 1 0 2.4-5.7" />
    <path d="M3.4 4.6v3.2h3.2" />
  </svg>
);

/**
 * The playback-rate control, and the reason it is a row of buttons rather than
 * a menu.
 *
 * Gated on `setPlaybackRate` reading `available`, which is this file exercising
 * the same rule the library's own controls apply to themselves — the group is
 * absent where the provider will not honour the command, never present and
 * disabled. The checked rung follows `PlayerState.playbackRate` and never a
 * local copy of it, so a rate the provider declined to apply cannot show as
 * selected.
 *
 * `aria-pressed` on plain buttons rather than a radio group: this is a toolbar
 * of toggles operated by Tab and Enter, which is what someone reaching for
 * 1.25× repeatedly wants, and a radio group would trade that for arrow-key
 * roving inside one stop.
 */
const RateControl = (): ReactElement | null => {
  const { playbackRate, status } = Player.usePlayerState((state) => ({
    playbackRate: state.playbackRate,
    status: state.capabilities.setPlaybackRate.status
  }));
  const actions = Player.usePlayerActions();
  if (status !== 'available') return null;
  return (
    <div aria-label="Playback speed" className="study-rates" role="group">
      <span aria-hidden="true" className="study-rates__label">
        Speed
      </span>
      {rates.map((rate) => (
        <button
          aria-pressed={playbackRate === rate}
          className="study-rate"
          key={rate}
          onClick={() => {
            void actions.setPlaybackRate(rate);
          }}
          type="button"
        >
          {rate}&times;
        </button>
      ))}
    </div>
  );
};

/**
 * The outline, and the study layout's way of getting around.
 *
 * Every entry is a real button that seeks, gated as a set on
 * `capabilities.seek`: anywhere seeking is not `available` the same list is
 * rendered as plain text, so the structure is still readable and nothing
 * offers an action that cannot be taken. That is the library's rule applied to
 * a control the library does not ship.
 *
 * All three states, and not two. `unavailable` is a refusal and says so;
 * `unknown` is undecided — which is what every capability reads before a
 * provider has attached, and this player is `loading="interaction"`, so it is
 * the state a visitor meets first. Printing the refusal there would state
 * something false about the source on the page whose argument is that this
 * distinction is the product. So the hint is bound to `unavailable` alone, and
 * `unknown` renders the list without a claim about why — the library's own
 * "a control reading `unknown` renders nothing" applied to the sentence rather
 * than to the control.
 *
 * The section being played is marked with `aria-current`, which is the
 * attribute for "the one of these you are on" and is what a screen reader
 * announces; the visible marker beside it is a shape and a weight rather than
 * colour alone.
 */
const Outline = (): ReactElement => {
  const { currentTime, seekStatus } = Player.usePlayerState((state) => ({
    currentTime: state.currentTime,
    seekStatus: state.capabilities.seek.status
  }));
  const actions = Player.usePlayerActions();
  const active = [...outline]
    .reverse()
    .find((section) => currentTime >= section.startTime);
  const navigable = seekStatus === 'available';

  return (
    <nav aria-label="Lesson outline" className="study-outline">
      <h3 className="study-panel__title">
        <OutlineGlyph />
        Outline
      </h3>
      <ol className="study-sections">
        {outline.map((section, index) => {
          const current = section.id === active?.id;
          const body = (
            <>
              <span className="study-section__index">{index + 1}</span>
              <span className="study-section__title">{section.title}</span>
              <span className="study-section__time">
                {clock(section.startTime)}
              </span>
            </>
          );
          return (
            <li key={section.id}>
              {navigable ? (
                <button
                  aria-current={current ? 'true' : undefined}
                  className="study-section"
                  onClick={() => {
                    void actions.seekTo(section.startTime);
                  }}
                  type="button"
                >
                  {body}
                </button>
              ) : (
                <span
                  aria-current={current ? 'true' : undefined}
                  className="study-section study-section--static"
                >
                  {body}
                </span>
              )}
            </li>
          );
        })}
      </ol>
      {seekStatus === 'unavailable' ? (
        <p className="study-hint">
          This source cannot be seeked, so the outline reads rather than
          navigates.
        </p>
      ) : null}
    </nav>
  );
};

/** How far through the outline the playhead is — a study readout, not a clock. */
const Progress = (): ReactElement => {
  const currentTime = Player.usePlayerState((state) => state.currentTime);
  const reached = outline.filter(
    (section) => currentTime >= section.startTime
  ).length;
  return (
    <p className="study-progress">
      Section {Math.max(reached, 1)} of {outline.length}
    </p>
  );
};

/*
 * What it takes to put `Player.ActivationButton` in normal flow.
 *
 * The library ships that part as a full-bleed overlay — `position: absolute`,
 * four zero offsets, `margin: auto`, `z-index: 30` — written as an inline style
 * on the element, which no stylesheet can outrank. The resume banner below
 * wants an ordinary button in a row of text, so all four are undone here.
 *
 * `margin` is the one worth naming: it is a deliberate no-op on the library's
 * own path, where four zero offsets and an auto size resolve auto margins to
 * zero, and it stops being one the moment the box becomes a flex item, whose
 * auto margins absorb the free space in its line.
 *
 * The picture's own start affordance a few lines down does NOT take this. It is
 * left exactly as the library ships it, because there the full-bleed overlay is
 * the design.
 */
const inFlow: CSSProperties = {
  position: 'static',
  inset: 'auto',
  margin: 0,
  zIndex: 'auto'
};

export type CoursePlatformPlayerProps = {
  /**
   * A same-origin WebVTT captions file. It arrives as a prop because each
   * surface serves its own copy from its own base path — the one thing about
   * this composition Storybook and the site cannot answer identically.
   */
  readonly captionsSrc: string;
  /**
   * Where this learner stopped last time, in seconds, or `null` for a first
   * visit. A real platform reads it from an enrolment record; the example takes
   * it as a prop rather than inventing a persistence layer it would then have
   * to defend.
   */
  readonly resumeAt?: number | null;
};

/**
 * The archetype: the composition, the recording it is pointed at, and the
 * loading strategy that holds it dormant. This is what a page mounts.
 *
 * `loading="interaction"` means nothing is fetched and no provider is attached
 * until the learner starts the lesson, so a course page carrying this player
 * makes no third-party request before that press.
 */
export const CoursePlatformPlayer = ({
  captionsSrc,
  resumeAt = null
}: CoursePlatformPlayerProps): ReactElement => (
  <Player.Root loading="interaction" source={bigBuckBunnyTrailer}>
    <CoursePlatformSurface captionsSrc={captionsSrc} resumeAt={resumeAt} />
  </Player.Root>
);

/**
 * Everything inside `Player.Root`, and the half of the archetype that has to be
 * separable from it: every hook below reads the player, and a hook can only
 * reach one from inside the root.
 *
 * Exported so a workbench story can supply its own root and dial the
 * capabilities in — which is the only way to see the whole control surface
 * without media and without a network — while `CoursePlatformPlayer` mounts the
 * recording.
 */
export const CoursePlatformSurface = ({
  captionsSrc,
  resumeAt = null
}: CoursePlatformPlayerProps): ReactElement => {
  const state = Player.usePlayerState((snapshot) => ({
    activation: snapshot.activation,
    errored: snapshot.error !== null,
    playing: snapshot.playback === 'playing',
    muted: snapshot.muted,
    fullscreen: snapshot.fullscreen
  }));
  const actions = Player.usePlayerActions();

  /*
   * The resume decision, carried from the press to the moment there is a player
   * to act on. A ref rather than state: nothing renders from it, and the
   * affordance that writes it unmounts as soon as the player is ready. The
   * effect clears the flag, so a later source swap cannot silently seek
   * somewhere nobody asked for.
   */
  const resumeRequested = useRef(false);
  const ready = state.activation === 'ready';
  useEffect(() => {
    if (!ready || !resumeRequested.current || resumeAt === null) return;
    resumeRequested.current = false;
    void actions.seekTo(resumeAt);
  }, [actions, ready, resumeAt]);

  /*
   * The transport is docked below the picture rather than laid over it, so
   * nothing here is competing with an overlay for the same pixels — but the
   * accessibility problem an overlay creates is the same one either way. While
   * `Player.ActivationButton` or `Player.ErrorDisplay` owns the picture, the
   * commands under it act on a player that does not exist yet, so the row is
   * taken out of layout, out of the accessibility tree and out of the tab order
   * with `hidden` rather than merely dimmed.
   */
  const notReady = !ready || state.errored;

  return (
    <>
      <style>{courseCss}</style>
      <section aria-label="Lesson" className="study">
        <div className="study-main">
          {resumeAt === null || ready ? null : (
            <div className="study-resume">
              <p className="study-resume__text">
                You stopped at {clock(resumeAt)}.
              </p>
              <Player.ActivationButton
                aria-label={`Resume the lesson from ${clock(resumeAt)}`}
                className="study-resume__button"
                onClick={() => {
                  resumeRequested.current = true;
                }}
                style={inFlow}
              >
                <ResumeGlyph />
                Resume
              </Player.ActivationButton>
            </div>
          )}

          <Player.Viewport className="study-stage">
            <Player.Media
              className="study-media"
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
            <Player.LoadingIndicator className="study-loading" />
            <Player.ErrorDisplay className="study-error">
              {({ error, retry }) => (
                <>
                  <p>{error.message}</p>
                  {retry ? (
                    <button
                      className="study-retry"
                      onClick={retry}
                      type="button"
                    >
                      Try again
                    </button>
                  ) : null}
                </>
              )}
            </Player.ErrorDisplay>
            {/* The library ships this part full-bleed with auto margins, so
                left at its own size it is the whole picture — one control, one
                accessible name, and a press anywhere on the frame starts the
                lesson. The badge is drawn as a ring on the button rather than
                as a second element over the picture. */}
            <Player.ActivationButton
              aria-label="Start the lesson"
              className="study-start"
            >
              <span aria-hidden="true" className="study-start__badge" />
            </Player.ActivationButton>
            <Player.Captions className="study-captions" hidden={notReady} />
          </Player.Viewport>

          {/* The docked transport. Two rows in normal flow under the picture:
              the scrubber, then the commands. Nothing auto-hides, because
              nothing is covering anything. */}
          <Player.Controls
            aria-label="Lesson player controls"
            className="study-transport"
            hidden={notReady}
          >
            <div className="study-row">
              <Player.Time className="study-time" type="current" />
              <Player.SeekSlider className="study-seek" />
              <Player.Time className="study-time" type="duration" />
            </div>
            <div className="study-row study-row--wrap">
              <Player.PlayButton className="study-chip">
                {state.playing ? <Player.PauseIcon /> : <Player.PlayIcon />}
              </Player.PlayButton>
              <Player.MuteButton className="study-chip">
                {state.muted ? <Player.MutedIcon /> : <Player.VolumeHighIcon />}
              </Player.MuteButton>
              <Player.VolumeSlider className="study-volume" />
              <RateControl />
              <span className="study-spacer" />
              <Player.CaptionsButton className="study-chip">
                <Player.CaptionsIcon />
              </Player.CaptionsButton>
              <Player.FullscreenButton className="study-chip">
                {state.fullscreen ? (
                  <Player.FullscreenExitIcon />
                ) : (
                  <Player.FullscreenEnterIcon />
                )}
              </Player.FullscreenButton>
            </div>
          </Player.Controls>

          <div className="study-heading">
            <h2 className="study-title">Rendering an open movie</h2>
            <Progress />
          </div>

          {/* The material. It is here because a study page that showed only a
              video would be the viewing archetype with a sidebar bolted on —
              somebody working through a lesson reads while the recording
              plays, and this is the half of the screen that says so. */}
          <div className="study-notes">
            <h3 className="study-panel__title">Notes</h3>
            <p>
              This lesson plays a Blender Foundation open movie. Its outline,
              the notes beside it and the caption text are fixtures this example
              ships — they mark time in the clip and make no claim about the
              film.
            </p>
            <p>
              Every control under the picture is drawn only where the player
              reports it can honour the command. Change the source to one that
              refuses seeking and the outline stops being buttons; change it to
              one that refuses a rate change and the speed row is not drawn at
              all.
            </p>
            <p className="study-credit">
              Big Buck Bunny &copy; Blender Foundation, licensed CC BY 3.0.
            </p>
          </div>
        </div>

        <aside className="study-rail">
          <Outline />
        </aside>
      </section>
    </>
  );
};

/*
 * The archetype's appearance, travelling with the composition for the reason
 * the streaming file gives: a headless library ships no look, so an archetype
 * that borrowed one from the page around it would be proving something about
 * that page. Both surfaces mount this file and get the same lesson.
 *
 * Container queries rather than viewport media queries: what decides whether
 * the rail sits beside the picture is how much room this component was given,
 * not how wide the window is.
 *
 * The whole of it is one template literal, so a backtick anywhere inside —
 * code-quoting in a comment included — closes the string early and turns the
 * rest of the stylesheet into JavaScript. The comments below use no quoting for
 * that reason.
 */
const courseCss = `
.study {
  container-type: inline-size;
  display: grid;
  gap: 1.5rem;
  width: 100%;
  padding: 1rem;
  border-radius: 0.75rem;
  background-color: #fbfaf7;
  color: #1a1a1f;
  font-family: ui-sans-serif, system-ui, sans-serif;
}
.study [hidden] {
  display: none !important;
}
.study-main {
  display: grid;
  gap: 1rem;
  align-content: start;
  min-width: 0;
}
/* The resume banner sits ABOVE the picture, in flow. The streaming archetype
   puts the same choice on a title card over the frame; here it is a line of the
   page, because a learner arrives at a lesson rather than at a title. */
.study-resume {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 0.75rem;
  align-items: center;
  padding: 0.6rem 0.85rem;
  border: 1px solid #d8d4c8;
  border-radius: 0.5rem;
  background-color: #f2efe6;
}
.study-resume__text {
  margin: 0;
  flex: 1 1 auto;
  font-size: 0.875rem;
}
.study-resume__button {
  display: inline-flex;
  gap: 0.4rem;
  align-items: center;
  min-height: 2.75rem;
  padding: 0 1rem;
  border: none;
  border-radius: 999px;
  background-color: #1f6f63;
  color: #fbfaf7;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.study-stage {
  position: relative;
  width: 100%;
  aspect-ratio: var(--playdeck-media-aspect-ratio, 16 / 9);
  overflow: hidden;
  border-radius: 0.5rem;
  background-color: #17171c;
}
.study-media {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
/* The whole frame is the start affordance, which is the library's own default
   for this part rather than something added here. Squared off deliberately: a
   border radius clips hit testing as well as paint, so a rounded full-bleed
   button answers clicks only inside the ellipse inscribed in it. */
.study-start {
  display: grid;
  place-items: center;
  border: none;
  border-radius: 0;
  background-color: transparent;
  cursor: pointer;
}
/* The badge is a ring with a triangle inside it, built from borders so the
   button needs no second element and no image. */
.study-start__badge {
  width: 4rem;
  height: 4rem;
  border: 2px solid #fbfaf7;
  border-radius: 999px;
  display: grid;
  place-items: center;
}
.study-start__badge::after {
  content: '';
  border-block: 0.6rem solid transparent;
  border-inline-start: 1rem solid #fbfaf7;
  border-inline-end: 0;
  translate: 0.15rem 0;
}
.study-captions {
  position: absolute;
  inset: auto 0 1rem 0;
  z-index: 20;
  justify-content: center;
  padding: 0 1rem;
  text-align: center;
}
.study-loading {
  position: absolute;
  inset-inline: 0;
  inset-block-start: 0.75rem;
  z-index: 25;
  color: #fbfaf7;
  font-size: 0.8125rem;
  text-align: center;
  pointer-events: none;
}
.study-error {
  position: absolute;
  inset: 0;
  z-index: 40;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background-color: #17171c;
  color: #fbfaf7;
  text-align: center;
}
.study-retry {
  min-height: 2.75rem;
  padding: 0 1.1rem;
  border: 1px solid #fbfaf7;
  border-radius: 999px;
  background-color: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
/* Docked, in flow, opaque, and never over the picture. */
.study-transport {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.study-row {
  display: flex;
  gap: 0.4rem;
  align-items: center;
}
.study-row--wrap {
  flex-wrap: wrap;
}
.study-seek {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
}
.study [data-playdeck-part='seek-slider-input'],
.study [data-playdeck-part='volume-slider'] {
  accent-color: #1f6f63;
  background-color: transparent;
  cursor: pointer;
}
/* Removing the line box, so the slider's container is the input's own 44px
   target and the track it runs along shares its centre. */
.study [data-playdeck-part='seek-slider-input'] {
  display: block;
}
.study [data-playdeck-part='seek-buffered'] {
  position: absolute;
  inset-inline: 0;
  inset-block-start: 50%;
  block-size: 0.25rem;
  translate: 0 -50%;
  border-radius: 0.125rem;
  background-color: #e0dcd0;
  /* The layer describes the control beneath it and must not swallow the seek
     it describes. */
  pointer-events: none;
}
.study [data-playdeck-part='seek-buffered-range'] {
  inset-block: 0;
  border-radius: inherit;
  background-color: #c6c1b1;
}
.study [data-playdeck-part='seek-progress'] {
  inset-block: 0;
  border-radius: inherit;
  background-color: #1f6f63;
}
.study-time {
  flex: 0 0 auto;
  color: #55555e;
  font-size: 0.8125rem;
  font-variant-numeric: tabular-nums;
}
.study-spacer {
  flex: 1 1 auto;
}
.study-chip {
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
.study-chip:hover {
  background-color: #ebe7dc;
}
.study-volume {
  flex: 0 0 auto;
  inline-size: 5rem;
}
/* Speed, out in the open. This is the control the archetype is built around,
   so it is given a label and a shape of its own rather than a slot in a menu. */
.study-rates {
  display: inline-flex;
  flex: 0 0 auto;
  gap: 0.15rem;
  align-items: center;
  padding: 0.15rem;
  border: 1px solid #ddd9cc;
  border-radius: 0.5rem;
}
.study-rates__label {
  padding-inline: 0.4rem;
  color: #55555e;
  font-size: 0.75rem;
}
.study-rate {
  min-height: 2rem;
  padding: 0 0.55rem;
  border: none;
  border-radius: 0.375rem;
  background-color: transparent;
  color: inherit;
  font: inherit;
  font-size: 0.8125rem;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
}
.study-rate:hover {
  background-color: #ebe7dc;
}
.study-rate[aria-pressed='true'] {
  background-color: #1f6f63;
  color: #fbfaf7;
  font-weight: 600;
}
.study-heading {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem 1rem;
  align-items: baseline;
  justify-content: space-between;
}
.study-title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
  letter-spacing: -0.01em;
}
.study-progress {
  margin: 0;
  color: #55555e;
  font-size: 0.8125rem;
  font-variant-numeric: tabular-nums;
}
.study-notes {
  display: grid;
  gap: 0.6rem;
  max-width: 60ch;
}
.study-notes p {
  margin: 0;
  color: #3c3c45;
  font-size: 0.9375rem;
  line-height: 1.6;
}
.study-credit {
  color: #6a6a74 !important;
  font-size: 0.75rem !important;
}
.study-panel__title {
  display: flex;
  gap: 0.4rem;
  align-items: center;
  margin: 0;
  color: #55555e;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.study-glyph {
  width: 1rem;
  height: 1rem;
}
.study-rail {
  min-width: 0;
}
.study-outline {
  display: grid;
  gap: 0.6rem;
  align-content: start;
  padding: 0.85rem;
  border: 1px solid #e4e0d4;
  border-radius: 0.5rem;
  background-color: #f5f3ec;
}
.study-sections {
  display: grid;
  gap: 0.15rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.study-section {
  display: grid;
  grid-template-columns: 1.4rem minmax(0, 1fr) auto;
  gap: 0.5rem;
  align-items: baseline;
  width: 100%;
  min-height: 2.75rem;
  padding: 0.4rem 0.5rem;
  border: none;
  border-radius: 0.375rem;
  background-color: transparent;
  color: inherit;
  font: inherit;
  font-size: 0.875rem;
  text-align: left;
  cursor: pointer;
}
.study-section--static {
  cursor: default;
}
.study-section:hover {
  background-color: #ebe7dc;
}
/* The section being played. Marked three ways — a weight, a rule and the
   aria-current the button already carries — because colour alone is never the
   only carrier of a state. */
.study-section[aria-current='true'] {
  background-color: #e6efec;
  box-shadow: inset 0.15rem 0 0 #1f6f63;
  font-weight: 600;
}
.study-section__index {
  color: #6a6a74;
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
}
.study-section__time {
  color: #6a6a74;
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
}
.study-hint {
  margin: 0;
  color: #6a6a74;
  font-size: 0.75rem;
}
/* Two columns once the component has the room for them. The rail is fixed and
   the picture takes what is left, so the lesson text keeps a readable width
   instead of the two sharing in proportion. */
@container (min-width: 52rem) {
  .study {
    grid-template-columns: minmax(0, 1fr) 18rem;
    gap: 1.75rem;
    padding: 1.5rem;
  }
  .study-outline {
    position: sticky;
    top: 1rem;
  }
}
@container (max-width: 30rem) {
  .study-volume {
    display: none;
  }
}
@media (prefers-reduced-motion: no-preference) {
  .study-chip,
  .study-rate,
  .study-section {
    transition: background-color 120ms ease;
  }
}
`;
