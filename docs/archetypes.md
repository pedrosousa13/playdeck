# Two archetypes

Two composed players, built from the same primitives for two different jobs.
One example proves a library can build a player; two prove the primitives
compose into genuinely different products, which is the claim a headless
library actually makes.

Both live in `examples/`, so the `examples` TypeScript project compiles them on
every `pnpm typecheck` and neither can go stale while the rest of the
repository stays green. Both are mounted from that one file by two surfaces:
the Storybook workbench as a story, and `/archetypes` on the site as an island
printed beside its own source. There is no second copy of either composition
anywhere.

## Named for the job, never for a company

Each is named for the job it does — a streaming-service layout, a
course-platform layout — and this is deliberate rather than merely cautious.

A functional pattern is not anybody's property and every player converges on
one: a scrubber, a chapter rail, a quality menu. What is protectable is a
particular company's trade dress, its icons and its name. A demo labelled with
a company's name makes a claim about a brand nobody here owns, and it goes
stale the moment that company redesigns. So: own type, own colour, original
icons, no logos and no company name in a label, a comment or a file name.

## What each one is for

|                | Streaming service          | Course platform                                 |
| -------------- | -------------------------- | ----------------------------------------------- |
| The reader is  | Watching                   | Studying                                        |
| The picture    | Owns the frame             | Shares the page with the lesson                 |
| The chrome     | Laid over the picture      | Docked under it, in flow, never covering        |
| Playback speed | Not offered                | A visible row, reached without opening anything |
| Quality        | A settings menu            | Not offered                                     |
| Chapters       | Marks on the scrubber      | An outline of buttons that seek                 |
| Resume         | A choice on the title card | A banner above the picture                      |

If the second ever becomes the first with different colours, it has failed at
its one job.

## Capability gating is the library's rule, not the example's

Neither file hardcodes a control set. `Player.MuteButton`, `Player.SeekSlider`,
`Player.CaptionsButton`, `Player.PipButton`, `Player.AirPlayButton` and
`Player.FullscreenButton` each gate themselves on the capability behind their
own command, and the blocks the examples add — the streaming layout's quality
menu, the course layout's speed row and its outline — read the same capabilities
and follow the same rule. A control whose command cannot be honoured is absent,
never present and disabled.

Two of those are worth watching against a real clip. The quality menu does not
appear in the streaming layout at all, because the native provider cannot switch
renditions of a progressive file and `selectQuality` says so — with nothing to
choose from, the trigger is not drawn either. And where seeking is refused, the
course layout's outline still renders — a learner needs the structure whether or
not they can jump into it — as text rather than as buttons.

## Media

Both clips are Blender Foundation open-movie trailers, played from the
foundation's own download host. Both are © Blender Foundation and licensed
[CC BY 3.0](https://creativecommons.org/licenses/by/3.0/), which requires
attribution: it is given in each example, on the site page that mounts them and
here.

The chapter marks, outline titles and caption text are fixtures the examples
ship. They mark time in each clip and describe neither film.

The accepted risk is the one the whole milestone carries: an upload can be
removed or made private by whoever posted it, which is why a link check is part
of this work rather than a promise.

## The streaming-service archetype

<!-- example:archetype-streaming-service -->

```tsx
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
 * It is named for the job — a service people sit down in front of — and not for
 * a company that does that job. Nothing here carries a logo, a company name, a
 * brand colour or an icon copied from one. The scrubber, the chapter rail and
 * the settings menu are functional patterns every player converges on; the
 * trade dress that would make this a claim about somebody's brand is exactly
 * what is left out.
 *
 * The point of the archetype is not the control list. It is the shape: one
 * picture that owns the screen, chrome that sits on top of it and gets out of
 * the way, and a viewer who is expected to start the thing and stop reading.
 * `examples/archetype-course-platform.tsx` is the same primitives arranged for
 * somebody who is studying, and the two are meant to be told apart at a glance
 * without a caption explaining which is which.
 *
 * Every control below is either a primitive that gates itself on a capability
 * or a block this file gates on one it read. Nothing is hardcoded into the bar
 * because "a player has one of those" — a control whose command cannot be
 * honoured is absent here rather than present and disabled, which is the
 * library's rule and not this example's.
 */

/*
 * The clip, and the whole of the media decision.
 *
 * The Sintel trailer, from the Blender Foundation's own download host. It is
 * CC-BY 3.0, which asks for attribution and gets it in the note under the
 * player below, and again on every page that mounts this file.
 *
 * Two containers for one clip, MP4 first: an engine with an H.264 decoder takes
 * the MP4 and nothing changes, while one without it falls through to the Theora
 * file instead of failing source selection outright. That is the reasoning
 * `stories/reference` uses for its MP4-then-WebM pair, and it is the reason
 * this is a `<source>` set rather than a bare URL string.
 *
 * The URLs are absolute, so nothing about them is resolved against a surface's
 * base path.
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
 * The clip AND every word on screen that describes it, as one value.
 *
 * This is what the composition plays and says unless a surface hands it
 * something else through the `media` prop below. A surface needs that: a page
 * whose own claim is that it makes no third-party request has to point this at
 * a clip it serves itself, and a default that could not be replaced would make
 * that page choose between the archetype and its own rule.
 *
 * The reason it is one object rather than a prop per field is a defect this
 * file has already had. When only the source could be replaced, a page pointed
 * it at its own test pattern and the title card went on announcing Sintel over
 * colour bars, with the CC-BY credit under it still naming a film nobody was
 * watching. Bundled, a surface cannot change the clip without being handed the
 * words for it — the kicker, the title, the blurb and the credit are the clip's
 * copy, and they travel with it.
 */
const sintel = {
  source: sintelTrailer,
  kicker: 'Short film',
  title: 'Sintel',
  blurb: 'A Blender Foundation open movie, played here from its own trailer.',
  credit: 'Sintel © Blender Foundation, licensed CC BY 3.0.'
} as const;

/*
 * The chapter list this layout offers when the provider has none of its own.
 *
 * A streaming service knows where its chapters are because the title carries
 * them, so `PlayerState.chapters` is read first and this is the fallback —
 * `useChapters` below prefers whatever the provider published. For a
 * progressive MP4 played by the native provider there is nothing to publish:
 * `capabilities.chapters` reads `unavailable` with the `source` reason, which
 * is the library saying the media has none rather than that it cannot look.
 *
 * The titles are the example's own fixture text and mark time in the clip
 * rather than describing the film. The page says so under the player, for the
 * same reason the hero's caption says its clip is a test pattern: a demo that
 * implied it had read metadata it invented would be the one dishonest thing on
 * a page about honesty.
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

const qualityLabel = (quality: {
  readonly id: string;
  readonly height: number | null;
  readonly bitrate: number | null;
}): string => {
  if (quality.height !== null) return `${quality.height}p`;
  if (quality.bitrate !== null)
    return `${Math.round(quality.bitrate / 1000)} kbps`;
  return quality.id;
};

/**
 * Quality selection, gated on `selectQuality`, and the whole menu absent when
 * there is no ladder to choose from.
 *
 * This is the one settings group the archetype offers, and the omission is as
 * deliberate as the inclusion. Playback rate is a studying control — somebody
 * working through a recording reaches for it constantly — so it belongs to
 * `examples/archetype-course-platform.tsx`, where it is out in the open, and a
 * viewing layout that also carried it would be blurring the one line between
 * the two files.
 *
 * The group disappears against the clip above, which is the point rather than
 * an accident: the native provider cannot switch renditions of a progressive
 * file, so `selectQuality` reads `unavailable`, and with nothing to offer the
 * trigger is not drawn either. That is the library's rule doing its work in the
 * direction that costs something — a menu that always listed "Auto / 1080p /
 * 720p" would be inventing a ladder the provider never published.
 */
const QualityMenu = (): ReactElement | null => {
  const state = Player.usePlayerState((snapshot) => ({
    status: snapshot.capabilities.selectQuality.status,
    qualities: snapshot.qualities,
    selectedQualityId: snapshot.selectedQualityId,
    activeQuality: snapshot.quality
  }));
  const actions = Player.usePlayerActions();
  if (state.status !== 'available' || state.qualities.length === 0) return null;

  return (
    <Player.SettingsMenu>
      <Player.SettingsMenuTrigger className="stream-chip">
        <Player.SettingsIcon />
      </Player.SettingsMenuTrigger>
      <Player.SettingsMenuContent className="stream-menu">
        <Player.MenuRadioGroup
          aria-label="Quality"
          onValueChange={(value) => {
            void actions.selectQuality(value === '' ? null : value);
          }}
          value={state.selectedQualityId ?? ''}
        >
          {/* Auto is the empty value, not a rung: `selectQuality(null)` is the
              library's way of handing the choice back to the provider. Its
              label names the level actually playing where the provider has
              published one, so "Auto" is never a claim about a height nobody
              reported. */}
          <Player.MenuRadioItem value="">
            {state.activeQuality?.height == null
              ? 'Auto'
              : `Auto (${state.activeQuality.height}p)`}
          </Player.MenuRadioItem>
          {state.qualities.map((quality) => (
            <Player.MenuRadioItem key={quality.id} value={quality.id}>
              {qualityLabel(quality)}
            </Player.MenuRadioItem>
          ))}
        </Player.MenuRadioGroup>
      </Player.SettingsMenuContent>
    </Player.SettingsMenu>
  );
};

/**
 * The chapter rail: ticks laid over the scrubber, and the name of the chapter
 * the playhead is inside.
 *
 * It is drawn inside `Player.SeekSlider`, which renders its children after its
 * own geometry, so the ticks share the slider's box without this file
 * measuring anything. They are `aria-hidden` and not focus targets: the slider
 * is already the seek control and its `aria-valuetext` already says where the
 * playhead is, so a second keyboard route across the same axis would be an
 * obstacle rather than an affordance. Chapter *navigation* is the course
 * layout's job, and it does it with real buttons.
 *
 * Nothing is drawn without a duration to place ticks against — before one
 * arrives every tick would land on zero.
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
 * What it takes to put `Player.ActivationButton` in normal flow, and why it is
 * an inline style rather than a rule in the stylesheet below.
 *
 * The library ships that part as a full-bleed overlay — `position: absolute`,
 * four zero offsets, `margin: auto`, `z-index: 30` — set as an inline style on
 * the element, which no stylesheet can outrank. So the four have to be undone
 * where they were set, and `margin` is the one that is easy to miss: it is a
 * deliberate no-op on the library's own path (four zero offsets with an auto
 * size resolve auto margins to zero) but a flex item's auto margins absorb the
 * free space in its line, which would push these two buttons apart and away
 * from the edge the card sets them against.
 *
 * The card's own layer is what positions this block; these buttons only have to
 * stop positioning themselves.
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
   * What to play, and what the layout says about it. Defaults to the trailer
   * above with the copy that describes it, so a consumer who copies this file
   * and passes nothing gets the whole archetype working from one paste.
   *
   * `source`, `kicker`, `title`, `blurb` and `credit` are one prop because they
   * are one claim: the clip, the title card that announces it — kicker, title
   * and blurb — and the line under the picture that says whose it is. A surface
   * that replaces the clip and not the words would be describing a film it is
   * not playing.
   *
   * The chapter fixture above is spaced for a clip of roughly the trailer's
   * length, and `ChapterRail` draws only the marks that fall inside the
   * duration. A shorter source therefore loses the marks past its last frame
   * rather than drawing them off the end — silently, since a rail with a tick
   * missing looks exactly like a fixture with fewer chapters.
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
 * `loading="interaction"` is not decoration on a demo. Nothing is fetched and
 * no provider is attached until the viewer presses one of the two affordances
 * on the title card, so a page carrying this player makes no request for media
 * — third-party or otherwise — until somebody asks for whatever the `media`
 * prop pointed it at, which is not always a film: on `/` it is a colour-bar
 * test pattern this site serves itself.
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
 * Everything inside `Player.Root`, and the half of the archetype that has to be
 * separable from it: every hook below reads the player, and a hook can only
 * reach one from inside the root.
 *
 * It is exported for one reason. A workbench story that wants to see the whole
 * control surface has to dial the capabilities in, and it can only do that by
 * supplying its own root — so it mounts this and `StreamingServicePlayer`
 * mounts the clip. `stories/reference` splits itself the same way for the same
 * reason.
 *
 * It takes the same `media` prop, and reads every field of it except `source`:
 * the words on the title card and in the credit are drawn here, the clip is
 * mounted by the root above. That is the reason the two are one object — split
 * across the two components as separate props, the copy and the clip are two
 * decisions, and two decisions drift. A story that supplies its own root and
 * passes no `media` gets the default bundle, so the workbench shows the title
 * card the file ships with.
 */
export const StreamingServiceSurface = ({
  captionsSrc,
  media = sintel,
  resumeAt = null
}: StreamingServicePlayerProps): ReactElement => {
  const state = Player.usePlayerState((snapshot) => ({
    activation: snapshot.activation,
    errored: snapshot.error !== null,
    playing: snapshot.playback === 'playing',
    muted: snapshot.muted,
    fullscreen: snapshot.fullscreen,
    pictureInPicture: snapshot.pictureInPicture
  }));
  const actions = Player.usePlayerActions();
  const { segments, fromProvider } = useChapters();

  /*
   * The resume decision, carried from the press that made it to the moment
   * there is a player to act on.
   *
   * A ref rather than state: nothing renders from it, and the two affordances
   * that write it are `Player.ActivationButton`s that unmount the instant the
   * player is ready — so a re-render triggered here would be a re-render of a
   * subtree that is being replaced anyway. The effect below fires once, on the
   * transition into `ready`, and clears the flag so a later swap of the source
   * does not silently seek somewhere nobody asked for.
   */
  const resumeRequested = useRef(false);
  const ready = state.activation === 'ready';
  useEffect(() => {
    if (!ready || !resumeRequested.current || resumeAt === null) return;
    resumeRequested.current = false;
    void actions.seekTo(resumeAt);
  }, [actions, ready, resumeAt]);

  /*
   * The two full-bleed overlays own the picture in exactly the states their own
   * render gates describe: `ActivationButton` before activation, `ErrorDisplay`
   * while an error stands. Content under one of them is invisible and
   * unclickable but still tabbable and still announced, which is WCAG 2.2 SC
   * 2.4.11, so the bar is taken out of the page entirely rather than merely
   * covered. `hidden` and not a conditional render, so the row leaves layout,
   * the accessibility tree and the tab order in one move without unmounting a
   * subtree that is about to come back.
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

          {/* The title block, and the two ways in. It is one absolutely
              positioned layer holding text plus the activation affordances,
              rather than a layer per element, so the whole of the dormant state
              lifts away in one move when the player is ready — the buttons
              inside it unmount themselves, and the text has nothing to say over
              a running picture.

              `Player.ActivationButton` renders nothing once activation reads
              `ready`, so this block is its own gate: with both buttons gone the
              card would be an empty box, and the `hidden` below is what takes
              it out of layout and out of the accessibility tree with them. */}
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
              <QualityMenu />
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
 * The archetype's appearance, and the reason it travels with the composition.
 *
 * A headless library ships no look, so an archetype that borrowed one from the
 * page around it would be proving something about that page instead. Both
 * surfaces mount this file and get the same player, which is what makes the
 * pair of archetypes a comparison rather than two screenshots taken under
 * different lighting.
 *
 * It is a `<style>` element rather than an imported stylesheet because the
 * `examples` TypeScript project compiles `.ts` and `.tsx` and knows nothing
 * about CSS imports, and because a consumer copying this file gets the whole
 * archetype in one paste.
 *
 * Container queries rather than viewport media queries: this player is embedded
 * in a page whose column width is not the window's, and a bar that wraps should
 * wrap when the PLAYER is narrow rather than when the phone is. An element is
 * never matched by its own container query, so the container is the section and
 * the rules key off it.
 *
 * The whole of it is one template literal, so a backtick anywhere inside —
 * code-quoting in a comment included — closes the string early and turns the
 * rest of the stylesheet into JavaScript. The comments below use no quoting for
 * that reason.
 */
const streamingCss = `
/* The archetype is one dark panel and not a picture with a caption under it.
   Its own ground rather than the host page's, because the credit line below the
   stage is set in the same light-on-dark scale as the chrome above it — read
   against whatever the page happens to be, that text has no contrast anybody
   can vouch for, which an accessibility scan reports as a real failure rather
   than as a matter of taste. */
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
/* Both affordances are real buttons from the library, so each is reachable by
   Tab and answers Enter and Space with no handler of this file's. What is set
   here is size and colour. What is NOT set is anything to do with where the box
   sits: the library writes that as an inline style, which no rule here could
   outrank, so the inFlow object above undoes it at the point of use instead.

   The fill and the border are set twice each, and the custom-property half is
   not decoration: ActivationButton writes background-color and border of
   its own as an inline style, reading --playdeck-activation-fill and
   --playdeck-activation-border (default transparent / 0), and an inline
   declaration outranks anything written here by class selector however it is
   written. Left unset, both buttons render fully transparent — this file's own
   background-color/border-color below never lands — which is invisible
   text on the dark card behind stream-primary and a border-only outline on
   stream-secondary. Setting the two tokens is how a consumer's stylesheet
   reaches this part at all. */
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
.stream-chip {
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
.stream-chip:hover {
  background-color: rgb(236 233 245 / 0.14);
}
.stream-volume {
  flex: 0 0 auto;
  inline-size: 5rem;
}
/* The effective caption mode, printed beside the toggle that turns captions on.
   The renderer is spelled out as a word, so the readout carries itself; the one
   colour below is an accelerator on top of that word and never the only carrier
   of it. */
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
.stream-menu {
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
.stream-menu [data-playdeck-part='menu-radio-item'] {
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
.stream-menu [data-playdeck-part='menu-radio-item']:hover,
.stream-menu [data-playdeck-part='menu-radio-item'][aria-checked='true'] {
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
/* Below this the bar alone needs the width, and two things go rather than wrap.
   The chapter name is a readout and costs nothing; the volume slider is a
   control, and setting a level IS lost here — the mute button that stays
   answers a different command. It goes anyway because at this width the slider
   is a 5rem target on a surface that almost certainly has hardware volume of
   its own, and because the alternative — folding it into the settings menu —
   would put a continuous control two presses deep. Named as a cost rather than
   claimed to be free. */
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
  .stream-secondary {
    transition: background-color 120ms ease;
  }
}
`;
```

<!-- /example -->

## The course-platform archetype

<!-- example:archetype-course-platform -->

```tsx
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
 * The recording AND everything the lesson says about it, as one value.
 *
 * This is what the composition plays and says unless a surface hands it
 * something else through the `media` prop below. A surface needs that: a page
 * whose own claim is that it makes no cross-origin request has to point this at
 * a recording it serves itself, and a default that could not be replaced would
 * make that page choose between the archetype and its own rule.
 *
 * The clip and the copy are one object because this file has already been
 * caught with them apart. When only the source could be replaced, a page
 * pointed it at its own test pattern and the lesson heading, the note and the
 * credit went on describing a Blender open movie that was not playing. Bundled,
 * a surface cannot swap the recording without being handed the three places
 * this layout talks about it.
 */
const openMovieLesson = {
  source: bigBuckBunnyTrailer,
  title: 'Rendering an open movie',
  note: 'This lesson plays a Blender Foundation open movie. Its outline, the notes beside it and the caption text are fixtures this example ships — they mark time in the clip and make no claim about the film.',
  credit: 'Big Buck Bunny © Blender Foundation, licensed CC BY 3.0.'
} as const;

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
 * The picture's own start affordance a few lines down does NOT take this: its
 * POSITIONING is left exactly as the library ships it, because there the
 * full-bleed overlay is the design. `.study-start` in the stylesheet gives it a
 * look — a centring grid, no border, no radius, no background — and touches
 * none of the four properties above.
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
  /**
   * The recording to play, and what the lesson says about it. Defaults to the
   * trailer above with the copy that describes it, so a consumer who copies
   * this file and passes nothing gets the whole archetype from one paste.
   *
   * The four fields are one prop because they are one claim: `source` is the
   * recording, `title` is the lesson heading over it, `note` is the first
   * paragraph of the notes panel beside it, and `credit` is the attribution
   * line under those notes. A surface that replaced the recording and not the
   * words would be teaching a lesson about something it is not playing.
   *
   * The outline above is spaced for a recording at least as long as the
   * trailer, and a much shorter one would leave sections nobody could reach.
   */
  readonly media?: {
    readonly source: Player.RootProps['source'];
    readonly title: string;
    readonly note: string;
    readonly credit: string;
  };
};

/**
 * The archetype: the composition, the recording it is pointed at, and the
 * loading strategy that holds it dormant. This is what a page mounts.
 *
 * `loading="interaction"` means nothing is fetched and no provider is attached
 * until the learner starts the lesson, so a course page carrying this player
 * makes no request for media — cross-origin or otherwise — before that press.
 */
export const CoursePlatformPlayer = ({
  captionsSrc,
  media = openMovieLesson,
  resumeAt = null
}: CoursePlatformPlayerProps): ReactElement => (
  <Player.Root loading="interaction" source={media.source}>
    <CoursePlatformSurface
      captionsSrc={captionsSrc}
      media={media}
      resumeAt={resumeAt}
    />
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
 *
 * It takes the same `media` prop and reads every field of it except `source`:
 * the heading, the note and the credit are drawn here, the recording is mounted
 * by the root above. That is why the two are one object — split across the two
 * components as separate props they would be two decisions, and two decisions
 * drift. A story that supplies its own root and passes no `media` gets the
 * default bundle, so the workbench shows the lesson the file ships with.
 */
export const CoursePlatformSurface = ({
  captionsSrc,
  media = openMovieLesson,
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
                lesson. The badge inside it is one `aria-hidden` span rather
                than an image or a second control: it is the button's mark, not
                a target of its own, so it adds nothing to the tab order and
                nothing to the accessible name above. */}
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
            <h2 className="study-title">{media.title}</h2>
            <Progress />
          </div>

          {/* The material. It is here because a study page that showed only a
              video would be the viewing archetype with a sidebar bolted on —
              somebody working through a lesson reads while the recording
              plays, and this is the half of the screen that says so. */}
          <div className="study-notes">
            <h3 className="study-panel__title">Notes</h3>
            <p>{media.note}</p>
            <p>
              Every control under the picture is drawn only where the player
              reports it can honour the command. Change the source to one that
              refuses seeking and the outline stops being buttons; change it to
              one that refuses a rate change and the speed row is not drawn at
              all.
            </p>
            <p className="study-credit">{media.credit}</p>
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
  /* ActivationButton writes background-color and border of its own as an
     inline style, reading --playdeck-activation-fill and
     --playdeck-activation-border (default transparent / 0) — an inline
     declaration outranks the background-color below however it is written,
     so left unset this button renders fully transparent and its near-white
     text sits unreadable on the banner's own light ground. Setting the two
     tokens is how a consumer's stylesheet reaches this part at all. */
  --playdeck-activation-fill: #1f6f63;
  --playdeck-activation-border: 0;
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
/* The badge is a ring with a triangle inside it, both drawn from borders — the
   ring from the span's own, the triangle from a pseudo-element's — so it costs
   no image and no request. */
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
```

<!-- /example -->
