/*
 * The bench: one player, two switches, and the composition those switches
 * just built.
 *
 * There used to be a third thing here, a line of what the mounted provider
 * refused. It named one capability out of however many a provider actually
 * refused, picked by the iteration order of a lookup table a reader could not
 * see, and reads as arbitrary because it was: which refusal appeared depended
 * on where its capability sat in `capabilityWords`, not on anything about the
 * refusal itself. Given the choice between naming every refusal a provider
 * makes and naming one chosen by object-key order, the capability argument
 * left `/` rather than keep doing the second -- the same page that had
 * already cut a five-row panel and a ten-by-five grid for the same reason,
 * one step further down. `bench-capabilities.ts` and `ReasonLine.tsx` went
 * with it.
 *
 * This file is the site's whole React surface and the only thing on `/` that
 * hydrates. It is here because the page's argument is about behaviour — that
 * nothing is fetched before a press, that a player's own report is worth
 * trusting, and that the knobs are compositions rather than options — and the
 * honest way to make an argument about behaviour is to run the thing.
 *
 * ---- one `Player.Root`, above everything -----------------------------------
 *
 * `Player.Root` renders no DOM at all: it is two context providers around its
 * children. So a single root stands above the player, the switches, the quiet
 * line and the panel, and the quiet line reads the same controller the player
 * is driven by rather than a second one of its own. That is what makes it a
 * report rather than a caption — there is no other controller for it to be
 * reading.
 *
 * ---- why the player travels and the readout stays --------------------------
 *
 * The player has to sit inside the frame `Bench.astro` draws, because the frame
 * carries `--elevation-instrument` and the sweep along its bottom edge, and an
 * Astro component cannot be a child of a React one. So the stage is portaled up
 * into `#bench-stage` while the quiet line and the readout render where this
 * island is placed.
 * `createPortal` keeps the stage inside this component's React tree — and so
 * inside `Player.Root`'s context — while rendering its DOM somewhere else,
 * which is the one primitive that lets the player leave without the readout
 * losing the controller it reports on.
 *
 * `base` arrives as a prop rather than being read here: this file is real
 * TypeScript under `apps/site/tsconfig.json`, whose `types` array is
 * deliberately empty, so it carries no ambient `ImportMetaEnv` declaration.
 * `SearchCommand.tsx` resolves the same global the same way.
 */
import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject
} from 'react';
import { createPortal } from 'react-dom';
import * as Player from '@playdeck/react';
/*
 * ---- how the skin switch applies a real stylesheet -------------------------
 *
 * Both skins are real, authored stylesheets now, and the switch has to be able
 * to load whichever one is selected without ever having both in the document at
 * once. `?url` is the mechanism: Vite emits each stylesheet as its own hashed
 * asset and this import is the string address of it, so no byte of either is in
 * the page's own CSS or JavaScript. The effect below appends a `<link>` at
 * whichever href the current skin resolves to and removes it on cleanup, the
 * same mechanism a consumer's bundler performs at build time, done at a
 * reader's request instead — now swapping between two real stylesheets rather
 * than adding and removing one.
 */
import themeHref from '@playdeck/react/theme.css?url';
import dockedHref from '@playdeck/react/docked.css?url';
import type { PlayerProvider } from '@playdeck/core';
import {
  benchSources,
  readySources,
  type BenchCredit,
  type BenchPoster
} from '@/bench-sources';
import { type BenchPosition, type SkinName } from '@/bench-composition';
import { BENCH_CONTROLS, type BenchControlName } from '@/bench-controls';
import { QUIET_START, quietLine, recordLoad } from '@/bench-quiet';
/*
 * The settings menu the bench mounts, taken from the examples rather than
 * written again here: `examples/react-menus.tsx` is where a consumer reads the
 * shape of a menu built from the parts, and a second copy on this page would
 * be a second thing to keep true. `apps/site/tsconfig.json` names the file in
 * its own `include` for this import -- see the comment there.
 */
import { RateMenu } from '../../../../examples/react-menus';
import BenchSwitches from './BenchSwitches';
import CompositionPanel from './CompositionPanel';

interface Props {
  /** `import.meta.env.BASE_URL`, read in `Bench.astro` and passed down. */
  readonly base: string;
  /** `Bench.astro`'s four precomputed strings, keyed `${provider}:${skin}`. */
  readonly compositions: Readonly<Record<string, string>>;
  /** The same four keys, holding the plain source `compositions` highlights. */
  readonly compositionSources: Readonly<Record<string, string>>;
}

/**
 * The bundle a position resolves to: the URL, the poster, the frame's
 * intrinsic dimensions, the start time and the credit, all read off one
 * `benchSources` entry so they can never drift apart from each other.
 * `sourceUrl` and `poster` are already resolved against the site's base path;
 * `startTime` is `0` on every entry today, so a press plays the film from its
 * own beginning rather than promising the moment the poster happens to show --
 * see the field's own comment in `bench-sources.ts` for why that replaced an
 * earlier version that pinned it to the poster's own timestamp.
 * `aspectRatio` is the CSS-ready `'width / height'` string, computed here
 * once from the two integers `bench-sources.ts` carries rather than a rounded
 * decimal anywhere -- `2048 / 858` is exact where `2.39` is not.
 *
 * Derived here rather than remembered separately, because `BenchPosition`
 * carries the provider and its URL and the two must not drift: `buildComposition`
 * prints the URL and stays pure by having no opinion about where one came
 * from, so something has to hold them together and it is the press that does
 * it. The poster, dimensions, start time and credit ride along with the same
 * lookup for the same reason -- `bench-sources.ts` bundles all of it into one
 * object per provider precisely so that nothing here can pick up the URL for
 * one position and the poster, shape, start time or credit for another.
 *
 * The throw is the same shape `index.astro` uses for a missing bundle target.
 * `benchSources` is built from a `Record<PlayerProvider, …>` and is therefore
 * total, but `find` cannot say so in the type, and a silent fallback would be
 * a player pointed somewhere, or shaped or naming something, nobody chose.
 */
type ResolvedSource = {
  readonly sourceUrl: string;
  readonly poster: BenchPoster;
  readonly aspectRatio: string;
  readonly startTime: number;
  readonly credit: BenchCredit;
};

const entryFor = (provider: PlayerProvider, base: string): ResolvedSource => {
  const entry = benchSources.find(
    (candidate) => candidate.provider === provider
  );
  if (entry === undefined) {
    throw new Error(`BenchIsland: ${provider} is not a bench source.`);
  }
  return {
    sourceUrl: entry.source(base),
    poster: entry.poster(base),
    aspectRatio: `${entry.width} / ${entry.height}`,
    startTime: entry.startTime,
    credit: entry.credit
  };
};

interface ControlBarProps {
  /**
   * Whether the activation press that is about to produce a player came from
   * the keyboard. Read once, when the bar appears, and cleared there.
   */
  readonly fromKeyboardRef: RefObject<boolean>;
}

/**
 * The control bar, in its own component because a toggle has to see the state
 * it is toggling and a hook can only read that from inside `Player.Root`.
 *
 * The buttons ship English wording as their own children when given none, and a
 * bar of words is the wrong register here. Passing an icon means passing both
 * halves of the pair, because a control whose label stops tracking its state is
 * worse than the words were: the accessible name is the library's and follows
 * the state, so the glyph beside it has to follow it too.
 *
 * One selector rather than one per button. `usePlayerState` compares what it
 * selected rather than the object it was handed back, so a single read wakes
 * this component only when one of the fields below moves — not on every time
 * update, which is what a naive read of a whole snapshot would cost on a bar
 * that contains a clock.
 */
const ControlBar = ({ fromKeyboardRef }: ControlBarProps) => {
  const state = Player.usePlayerState((snapshot) => ({
    activation: snapshot.activation,
    playing: snapshot.playback === 'playing',
    muted: snapshot.muted,
    fullscreen: snapshot.fullscreen,
    pictureInPicture: snapshot.pictureInPicture
  }));
  /*
   * Where the keyboard goes when the affordance it was standing on disappears.
   *
   * `Player.ActivationButton` unmounts at the moment the player is ready, and a
   * browser drops focus to `<body>` when the focused element leaves the
   * document. The library restores focus for its own capability-gated controls,
   * but the activation button is outside `Player.Controls`, so nothing catches
   * this one. Left alone, a reader who pressed Enter is standing on nothing: no
   * ring, and no media shortcut, because Space belongs to `Player.Controls`
   * only while focus is inside it.
   *
   * The play button is where they land, because it is the same command they
   * just gave, and Tab from there walks the rest of the bar.
   *
   * Only for a keyboard press. `fromKeyboardRef` is written by the activation
   * button from the browser's own answer to "was the ring showing" — a pointer
   * press leaves no `:focus-visible` — because moving focus after a click would
   * put a ring on screen that the reader did not ask for.
   */
  const playButton = useRef<HTMLButtonElement>(null);
  const ready = state.activation === 'ready';
  useEffect(() => {
    if (!ready || !fromKeyboardRef.current) return;
    fromKeyboardRef.current = false;
    playButton.current?.focus();
  }, [fromKeyboardRef, ready]);
  /*
   * Keyed by `BenchControlName`, so the tuple in `bench-controls.ts` is the one
   * place either the mounted tree here or the printed tree in
   * `bench-composition.ts` can grow or shrink from: a name added there and not
   * answered here is a missing key on a total `Record` and does not compile.
   *
   * The values are elements rather than component references, because two of
   * them are not a component alone -- `playButton` carries the `ref` the focus
   * move above writes into, and `timeDuration` carries the separator that
   * belongs in front of it. A table of components could hold neither.
   *
   * The separator is the page's own text rather than a gap opened in CSS,
   * because a skin that draws no rule between the two `<time>` elements renders
   * them flush against each other as `1:2410:34`. That reads as a defect rather
   * than as an unstyled control, and a consumer writing this bar by hand would
   * put a separator in for the same reason, so the composition prints one. It
   * travels with `timeDuration` rather than taking an eleventh entry of its
   * own, because it is consumer text and not a part.
   */
  const controls: Record<BenchControlName, ReactNode> = {
    seekSlider: <Player.SeekSlider />,
    playButton: (
      <Player.PlayButton ref={playButton}>
        {state.playing ? <Player.PauseIcon /> : <Player.PlayIcon />}
      </Player.PlayButton>
    ),
    muteButton: (
      <Player.MuteButton>
        {state.muted ? <Player.MutedIcon /> : <Player.VolumeHighIcon />}
      </Player.MuteButton>
    ),
    volumeSlider: <Player.VolumeSlider />,
    timeCurrent: <Player.Time type="current" />,
    timeDuration: (
      <>
        <span aria-hidden="true"> / </span>
        <Player.Time type="duration" />
      </>
    ),
    captionsButton: <Player.CaptionsButton />,
    settingsMenu: <RateMenu />,
    pipButton: (
      <Player.PipButton>
        {state.pictureInPicture ? (
          <Player.PipExitIcon />
        ) : (
          <Player.PipEnterIcon />
        )}
      </Player.PipButton>
    ),
    fullscreenButton: (
      <Player.FullscreenButton>
        {state.fullscreen ? (
          <Player.FullscreenExitIcon />
        ) : (
          <Player.FullscreenEnterIcon />
        )}
      </Player.FullscreenButton>
    )
  };
  return (
    /*
     * A focusable region that owns the media keyboard map — Space, the arrows,
     * `m`, `f` — and owns them only while focus is inside it.
     *
     * Each control is capability-gated by the library rather than by this page.
     * `Player.FullscreenButton` is the visible instance: it renders only while
     * the fullscreen capability reads `available`, so where fullscreen is
     * refused it is absent rather than present and dead. `VolumeSlider`,
     * `CaptionsButton`, the settings menu and `PipButton` are gated the same
     * way, which is why mounting all ten costs a provider that refuses some of
     * them nothing.
     *
     * Rendered by mapping over `BENCH_CONTROLS` rather than by writing the
     * children out here, because the theme's grid splits row one from row two
     * by source order and has no wrapper element to split on: the order in the
     * tuple *is* the layout, and one list nothing can reorder by hand is what
     * keeps it that way.
     *
     * Hidden until the activation has produced a player, which is the mirror of
     * the affordance's own render condition — the bar arrives exactly as the
     * button leaves. Playback is the one command with no capability to gate on,
     * so before a provider is attached the play control would be present and
     * inert. `hidden` rather than a conditional render, because it takes the
     * row out of layout, out of the accessibility tree and out of the tab order
     * at once, without unmounting a subtree that is about to come back.
     */
    <Player.Controls hidden={!ready}>
      {BENCH_CONTROLS.map((name) => (
        <Fragment key={name}>{controls[name]}</Fragment>
      ))}
    </Player.Controls>
  );
};

/**
 * What a click on the picture does once the clip is running: toggle playback,
 * which is the platform convention every desktop player follows. Adapted from
 * `SurfaceToggle` in the pre-rebuild `HeroPlayerIsland.tsx` (`git show
 * 61599a4855:apps/site/src/components/HeroPlayerIsland.tsx`) -- the same
 * technique, carried over because the reasoning still holds and there is no
 * reason to reinvent it.
 *
 * It is `Player.PlayButton` rather than a click handler on the viewport,
 * because the thing being asked for is the play control with a bigger box —
 * and the library's button already carries the parts of that which are easy to
 * get wrong. Its accessible name follows the state, so the surface reads
 * "Pause" while the clip runs and "Play" while it is stopped rather than
 * saying one of the two forever; it tags its command `'user'`; and its
 * `aria-pressed` states which way the toggle currently sits. A handler here
 * would have reproduced all of that, or quietly not.
 *
 * Rendered only once the activation has produced a player, which is the same
 * gate `ControlBar` puts on the bar and for the same reason: before that, a
 * full-bleed play control would sit over the picture doing nothing, and
 * clicking the stage would meet an inert button instead of the activation
 * affordance beneath it. The two never coexist — `Player.ActivationButton`
 * removes itself at exactly the moment this appears, so there is never a
 * frame with both mounted and never a frame with neither.
 *
 * `tabIndex={-1}` because this is a pointer target and not a second control.
 * A tab stop here would put a second thing named "Pause" in front of the bar
 * without offering anything the bar's own `Player.PlayButton` does not.
 * Driving it with a keyboard confirms the tab order stays one control long:
 * from a source or skin switch, Tab lands on the bar's play button directly,
 * never on this one first. What makes that safe is not that the keyboard has
 * no other route to the command at the moment of activation — it has none,
 * which is why `ControlBar` moves focus into the bar on a keyboard press —
 * but that once focus is in the bar there are two: the bar's own play button,
 * and Space or `k` anywhere inside `Player.Controls`.
 *
 * The empty fragment is how a `Player` button is given no visible content: the
 * library falls back to printing its own English wording for `children` that
 * are nullish, and this control's whole face is the picture behind it.
 */
const SurfaceToggle = () => {
  const ready = Player.usePlayerState(
    (snapshot) => snapshot.activation === 'ready'
  );
  if (!ready) return null;
  return (
    <Player.PlayButton data-surface-toggle="" tabIndex={-1}>
      <></>
    </Player.PlayButton>
  );
};

/**
 * The player, which is the largest thing on the page and the thing every
 * switch under it operates.
 *
 * It renders into the frame `Bench.astro` draws rather than here — see the
 * portal below — so this component is the composition and nothing about the
 * frame around it.
 */
const Stage = ({
  poster,
  skin,
  source
}: {
  readonly poster: BenchPoster;
  readonly skin: SkinName;
  readonly source: PlayerProvider;
}) => {
  /*
   * How the activation was given, carried from the press to the render that
   * replaces the button. A ref rather than state, because nothing renders from
   * it and a re-render here would be a re-render of the whole player.
   *
   * `:focus-visible` is the test rather than a modality guess of this file's
   * own: it is the browser's own record of whether this element was showing a
   * focus ring at the moment it was pressed, which is exactly the question.
   */
  const fromKeyboardRef = useRef(false);
  return (
    /*
     * `data-bench-skin` is what scopes `Bench.astro`'s docked-only layout
     * rules -- the viewport's two-row grid, its `::before` ratio box, and the
     * control bar's own row -- to the `docked` position; the badge-redraw
     * rule needs no such scoping, since both skins hit the same defect. It
     * rides on the viewport rather than on `.bench__stage` because the
     * viewport is React's: the attribute then arrives in the same commit as
     * the state it reports, where writing it onto the Astro element would
     * mean a `setAttribute` in an effect and a frame in which the document
     * and the switch disagree.
     */
    <Player.Viewport data-bench-skin={skin}>
      <Player.Media />
      {/* The still, over the picture until a frame has decoded, and taken away
       * by the library's own poster state machine rather than by anything
       * here. `Player.Poster` places itself — absolute, inset 0, above the
       * media and below the activation button, and `pointer-events: none`, so
       * a press on the picture still reaches the button behind it.
       *
       * A real `<img>`, which `Player.PosterImage` renders. That is what the
       * poster state machine needs to watch, and it is also what this
       * repository requires of every poster: a CSS background image would fail
       * both the `no-restricted-syntax` rule over `apps/**` and
       * `e2e/poster.spec.ts`'s stylesheet scan.
       *
       * `alt=""` because the still is decorative here. It is a frame of the
       * clip the control beside it is labelled to play, so describing it would
       * announce the same thing twice to a reader who cannot see either.
       *
       * `srcSet` carries both widths `bench-sources.ts` ships -- 1024w and the
       * film's own 2048w -- and `sizes` is `100vw` rather than a measurement of
       * this frame's actual CSS width at every breakpoint: the frame is never
       * wider than the viewport, so `100vw` never under-selects and asks a
       * browser to pick the smaller file only where the viewport itself is
       * narrow. `src` stays the 1024w file, for the one reader whose browser
       * reads neither attribute.
       *
       * `showWhilePaused` only for `youtube`: that is the one position whose
       * iframe draws its own chrome -- a title bar, a "more videos" shelf, a
       * pause glyph -- over an idle embed once nothing on this side covers
       * it, and the poster reappearing while paused is what covers it back
       * up. `vimeo` and every native position already show their own paused
       * frame underneath, which is what the library's default (off) leaves
       * alone. */}
      <Player.Poster showWhilePaused={source === 'youtube'}>
        <Player.PosterImage
          alt=""
          src={poster.src}
          srcSet={poster.srcSet}
          sizes="100vw"
        />
      </Player.Poster>
      {/* Before the control bar and after the picture, which is the order the
       * stacking in the `<style>` block below reads: at equal `z-index` the
       * later sibling paints in front, so the bar's own buttons stay on top of
       * this and keep their clicks. */}
      <SurfaceToggle />
      <Player.ActivationButton
        aria-label="Load and play the sample clip"
        onClick={(event) => {
          fromKeyboardRef.current =
            event.currentTarget.matches(':focus-visible');
        }}
      >
        <Player.PlayIcon />
      </Player.ActivationButton>
      <ControlBar fromKeyboardRef={fromKeyboardRef} />
    </Player.Viewport>
  );
};

/**
 * The line under the frame, and the page's central claim stated as a fact about
 * the page the reader is on rather than as a sentence about the library.
 *
 * It is live because a static one stops being true. "No provider has been
 * contacted" is exact until somebody presses play, and then it is a false
 * sentence printed directly under the thing that falsified it — on a page
 * whose whole argument is that its statements can be checked.
 *
 * **It is replaced, never removed.** Deleting the line when it stops applying
 * would move everything below it on the same gesture that starts a video. So
 * every state is one `<p>` with different words in it, kept close enough in
 * length that none of them wraps to a different number of lines at the widths
 * this page was measured at.
 *
 * **The words are a function of what the page has done, not of what the player
 * is doing.** `bench-quiet.ts` holds that state and the reasoning for it; the
 * short version is that reading the live activation state let two presses make
 * this line deny a request it had already made, because a source change returns
 * `Player.Root` to `dormant`. What this component owes that module is one call
 * at the moment a source begins loading, and nothing else.
 *
 * The cross-origin states are reachable now that `youtube` and `vimeo` are
 * `ready: true` in `bench-sources.ts`, which is what surfaced the race
 * `sourceJustChanged` guards below -- see its comment.
 */
const QuietLine = ({ sourceUrl }: { readonly sourceUrl: string }) => {
  const [history, setHistory] = useState(QUIET_START);

  // `'dormant'` alone, and not `'eligible'` beside it. `useActivation`'s
  // `activate` sets `'eligible'` as its first act after the press, once the
  // load is committed — so a snapshot carrying it means the reader has already
  // asked and something is already on its way. Erring to that side is
  // deliberate: this line must never be later than the request it describes.
  const stillActive = Player.usePlayerState(
    (snapshot) => snapshot.activation !== 'dormant'
  );

  /*
   * Whether `sourceUrl` is the same one this component saw on its previous
   * render.
   *
   * `Player.Root` resets its own activation to `'dormant'` on a source change
   * from a `useLayoutEffect` in `use-activation.ts`, which fires after this
   * component's render commits -- so on the exact render where `sourceUrl`
   * changes, `stillActive` above can still read the *previous* source's
   * activation, true because a clip was mid-playback a moment ago. Trusting
   * it on that render would attribute an old provider's activity to the new
   * `sourceUrl` and record a load that never happened: switching from a
   * playing `youtube` position to `vimeo`, with no second press, made this
   * line claim vimeo.com had been contacted -- measured, reliably, on every
   * switch away from a source that was still active. `native` and `hls`
   * could never have shown this: both resolved to `lastLoadedHost: null`, so
   * the wrong record and the right one printed the same sentence and the
   * defect was invisible until a hosted provider had a name to misattribute.
   *
   * A ref rather than a second `useState`: the guard only has to survive
   * until the render after this one, and a `setState` here -- even inside an
   * effect -- would ask React for a render this component does not need to
   * ask for, on top of the one `Player.Root`'s own effect already causes.
   * `stillActive` gets read fresh next render regardless, because the
   * activation reset above triggers its own re-render; this ref only has to
   * be *right* for the render in between, not cause one.
   */
  /* eslint-disable react-hooks/refs -- read and written in the same render,
   * deliberately, to compare against the previous render's value; see the
   * comment above. Root does the same for the same reason (`root.tsx`'s
   * `controlledMuted.current = muted` block and its siblings). */
  const lastSourceUrl = useRef(sourceUrl);
  const sourceJustChanged = lastSourceUrl.current !== sourceUrl;
  lastSourceUrl.current = sourceUrl;
  /* eslint-enable react-hooks/refs */
  const loading = !sourceJustChanged && stillActive;

  /*
   * Recorded when a source begins loading, never when one is selected — see
   * `bench-quiet.ts` for why those differ and why the difference is another way
   * to be wrong.
   *
   * Adjusted during render rather than in an effect. This is React's own
   * documented shape for state derived from a prop change, and `Player.Root`
   * uses it a few files away for the same kind of job (`root.tsx`, where
   * `sourceTransition` is reset the moment `sourceKey` moves). An effect would
   * paint one frame of the previous sentence first, which for this line means
   * printing "no provider has been contacted" for a frame after one has —
   * briefly, but the whole point of the line is that it is never that. It also
   * trips `react-hooks/set-state-in-effect`, which is the lint rule for exactly
   * this mistake.
   *
   * `recordLoad` hands back the object it was given when nothing moved, so the
   * comparison below is an identity check and the re-render happens at most
   * once per real change.
   */
  const next = loading
    ? recordLoad(history, sourceUrl, window.location.href)
    : history;
  if (next !== history) setHistory(next);

  return <p className="bench__quiet">{quietLine(next)}</p>;
};

/**
 * The CC BY credit for whichever film the source switch has selected.
 *
 * `Bench.astro` prints this same markup as static text inside `<noscript>`,
 * for the one film that position resolves to without any script running. This
 * is the live counterpart: once the island has mounted, the static paragraph
 * is never on screen (it is `<noscript>`, and `display: none` while scripts
 * run), and every position the source switch can reach -- not only the
 * default one -- needs its own credit naming its own film, holder and
 * licence. Deriving it from `credit` rather than writing it once is what
 * keeps a source press from leaving the previous film's name under a
 * different film's picture, the mirror image of the poster mismatch this
 * bundle exists to rule out.
 *
 * `bench__credit` rather than a name of its own: this is the same visual
 * treatment as `Bench.astro`'s static paragraph, and `:global(.bench__credit)`
 * in that file's stylesheet reaches an element from either tree.
 */
const Credit = ({ credit }: { readonly credit: BenchCredit }) => (
  <p className="bench__credit">
    <em>{credit.title}</em> &copy; {credit.holder}, licensed{' '}
    <a href={credit.licenceUrl} rel="license">
      {credit.licenceLabel}
    </a>
    .
  </p>
);

/**
 * Where the stage actually lands: not here, but inside the frame
 * `Bench.astro` draws above this island.
 *
 * The mount element is read once, lazily. This component is `client:only`, so
 * the function body runs in a browser already holding the page's full static
 * markup, mount element included, and there is nothing to wait on with an
 * effect. A lookup that failed would mean `Bench.astro` stopped rendering the
 * element, which is a defect this line is not the place to guard against.
 *
 * ---- why the shape of the box is written here rather than read from the media
 *
 * `#bench-stage` is `Bench.astro`'s box, sized before any player exists and
 * still the thing that has to be the right shape once one does -- so its
 * `aspect-ratio` cannot come from the media element inside it, which is
 * further down the tree and, for a provider like `youtube` that never
 * publishes real dimensions (see `MEDIA_ASPECT_RATIO_PROPERTY` in
 * `viewport-media.tsx`), may never report one at all. `bench-sources.ts`'s
 * `width`/`height` are the honest source of the film's own shape regardless
 * of what any given provider measures, so this writes them straight onto the
 * mount node as `--bench-aspect-ratio` -- the custom property
 * `.bench__stage`'s own rule in `Bench.astro` reads -- the same way
 * `Bench.astro` sets it inline for the position the page rests on before this
 * component ever mounts.
 *
 * `data-bench-skin` is mirrored onto the same mount node for the same reason:
 * `docked`'s second row makes `Player.Viewport` -- which carries this
 * attribute itself, see `Stage` below -- taller than this outer box's own
 * ratio-locked cell can hold, and `Bench.astro`'s `.bench__stage[data-bench-skin='docked']`
 * rule is what stops constraining that cell's height once a reader is on that
 * skin. Written here rather than left for `Bench.astro`'s own markup to carry
 * a default, because there is no default: `#bench-stage` does not know the
 * skin until a script has read `matchMedia` or a reader has pressed the
 * switch, the same reason `--bench-aspect-ratio` above is script-written and
 * not printed inline for every position in advance. */
const StagePortal = ({
  poster,
  aspectRatio,
  skin,
  source
}: {
  readonly poster: BenchPoster;
  readonly aspectRatio: string;
  readonly skin: SkinName;
  readonly source: PlayerProvider;
}) => {
  const [mount] = useState(() => document.getElementById('bench-stage'));
  useEffect(() => {
    mount?.style.setProperty('--bench-aspect-ratio', aspectRatio);
  }, [mount, aspectRatio]);
  const isFirstSkinRender = useRef(true);
  useEffect(() => {
    if (mount === null) return;
    mount.setAttribute('data-bench-skin', skin);

    if (isFirstSkinRender.current) {
      isFirstSkinRender.current = false;
      return;
    }
    /*
     * The crossfade (2026-09-03): a hard drop to 0.6 opacity with no
     * transition, then removed on the next animation frame so the return to
     * 1 crosses `.bench__stage`'s own `transition: opacity 240ms`. Skipped
     * outright under reduced motion, rather than relying on the site's
     * global 0.01ms transition-duration collapse: that rule only shortens a
     * transition that was going to run anyway, and `DESIGN.md`'s "Entry
     * motion" section holds a visible reveal like this one to "removed, not
     * shortened" -- the same reason `index.astro`'s own entrance is gated on
     * a media query rather than left to that global rule.
     */
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }
    mount.setAttribute('data-stage-flip', '');
    requestAnimationFrame(() => {
      mount.removeAttribute('data-stage-flip');
    });
  }, [mount, skin]);
  if (mount === null) return null;
  return createPortal(
    <Stage poster={poster} skin={skin} source={source} />,
    mount
  );
};

const BenchIsland = ({ base, compositions, compositionSources }: Props) => {
  /*
   * The default follows `matchMedia`, read once, synchronously, the same way
   * `readySources[0]` already is: `theme` rests above 48rem, `docked` below
   * it, because the floating theme was already collapsing toward close to
   * `docked`'s own layout at that width -- see the spec's own account of why.
   */
  const [position, setPosition] = useState<BenchPosition & ResolvedSource>(
    () => {
      // `readySources[0]` rather than a literal `'youtube'`: that entry is the
      // switch's default position because it is first among the ready entries
      // in `bench-sources.ts`, and reading the same fact from the same place
      // `Bench.astro`'s fallback does -- `benchSources.find((entry) => entry.ready)`
      // -- is what keeps the two in agreement without either naming a provider
      // by hand.
      const initial = readySources[0];
      if (initial === undefined) {
        throw new Error('BenchIsland: no ready bench source to default to.');
      }
      return {
        source: initial.provider,
        skin: window.matchMedia('(min-width: 48rem)').matches
          ? 'theme'
          : 'docked',
        ...entryFor(initial.provider, base)
      };
    }
  );

  // The skin, applied and removed as a real `<link>` — see the import above
  // for why that rather than an import of either kind. Always exactly one
  // `<link>` in the head: every position now ships a stylesheet, so this is a
  // swap between two hrefs rather than a conditional add and remove.
  useEffect(() => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = position.skin === 'theme' ? themeHref : dockedHref;
    document.head.append(link);
    return () => {
      link.remove();
    };
  }, [position.skin]);

  // `Bench.astro`'s frontmatter precomputes one highlighted string per
  // reachable (source, skin) pair -- see its own comment for why that is
  // exhaustive. The throw below is safe only because Task 5 already landed:
  // `position.skin` can no longer be `'none'`, so every reachable `position`
  // has an entry here.
  const html = compositions[`${position.source}:${position.skin}`];
  if (html === undefined) {
    throw new Error(
      `BenchIsland: no precomputed composition for ${position.source}:${position.skin}.`
    );
  }

  const source = compositionSources[`${position.source}:${position.skin}`];
  if (source === undefined) {
    throw new Error(
      `BenchIsland: no precomputed source for ${position.source}:${position.skin}.`
    );
  }

  /*
   * The changed line indices between the previous render's composition and
   * this one, 1-indexed to match the `data-line` attribute `Bench.astro`'s
   * `markLineNumbers` transformer stamps on each Shiki line span.
   *
   * A ref rather than state: this only has to be right for the render it is
   * read in (`CompositionPanel`'s own effect, keyed on `html`), and setting
   * state here would ask React for a render this component does not need.
   * `Player.Root`'s own `controlledMuted.current = muted` pattern does the
   * same thing for the same reason (see its comment).
   */
  /* eslint-disable react-hooks/refs -- read and written in the same render,
   * deliberately, to compare against the previous render's value; see the
   * comment above. `QuietLine`'s `lastSourceUrl` does the same thing for the
   * same reason (see its comment). */
  const previousSourceRef = useRef(source);
  const changedLines: readonly number[] = (() => {
    const previous = previousSourceRef.current;
    previousSourceRef.current = source;
    if (previous === source) return [];
    const previousLines = previous.split('\n');
    const nextLines = source.split('\n');
    const changed: number[] = [];
    for (let index = 0; index < nextLines.length; index++) {
      if (nextLines[index] !== previousLines[index]) changed.push(index + 1);
    }
    return changed;
  })();
  /* eslint-enable react-hooks/refs */

  return (
    /*
     * `loading="interaction"` is the whole of the page's at-rest claim, used
     * here for real: the root stays dormant until the activation affordance is
     * pressed, so the clip is not fetched and no provider is attached before
     * that press. A page that preloaded its media while saying nothing loads
     * before a click would be the one thing on it contradicting it.
     *
     * It also settles `prefers-reduced-motion` without a branch of its own:
     * nothing moves until a reader asks it to.
     *
     * `defaultMuted` is the uncontrolled form — the player opens silent and
     * then owns the value, so `Player.MuteButton` can hand it back.
     *
     * ---- there is no `key` on this element, and that is checked ------------
     *
     * It carried one while the bench had an autoplay switch, because `Root`
     * reads its autoplay configuration out of a ref at the moment media
     * attaches and `#synchronizeAutoplay` refuses a second attempt for a
     * generation it has already attempted — so a live change would have
     * configured something that was never acted on, and only a remount put the
     * player into the state the switch claimed. That switch is gone, and the
     * key went with it rather than being left as a harmless constant.
     *
     * Neither remaining switch wants one. `source` must not have one: `Root`
     * handles a source transition internally through `sourceKey`, so a change
     * of provider is a prop change and a key there would throw the controller
     * away for a job it already does. `skin` must not have one either: it adds
     * and removes a stylesheet in the document head and touches no player state
     * at all, so remounting for it would discard the reader's position to
     * repaint the chrome.
     */
    <Player.Root
      loading="interaction"
      source={position.sourceUrl}
      startTime={position.startTime}
      defaultMuted
    >
      <StagePortal
        poster={position.poster}
        aspectRatio={position.aspectRatio}
        skin={position.skin}
        source={position.source}
      />
      <Credit credit={position.credit} />
      {/* The readout: the two switch groups and the quiet line in one row
       * (2026-09-03's stage redraw), the composition full width below. */}
      <div className="grid gap-[var(--space-6)]">
        <div className="flex flex-wrap items-end justify-between gap-[var(--space-4)]">
          <BenchSwitches
            onSkin={(skin: SkinName) =>
              setPosition((current) => ({ ...current, skin }))
            }
            onSource={(source) =>
              setPosition((current) => ({
                ...current,
                source,
                ...entryFor(source, base)
              }))
            }
            skin={position.skin}
            source={position.source}
          />
          <QuietLine sourceUrl={position.sourceUrl} />
        </div>
        <CompositionPanel html={html} changedLines={changedLines} />
      </div>
    </Player.Root>
  );
};

/*
 * The default export is what the island loader resolves: Astro looks the
 * component up by export name and that name defaults to `default`. The
 * declaration above keeps its own name anyway, because an anonymous default is
 * what React reports in a stack trace and in the devtools tree.
 */
export default BenchIsland;
