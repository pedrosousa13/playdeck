/*
 * The bench: one player, two switches, one line of what the provider refused,
 * and the composition those switches just built.
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
 * children. So a single root stands above the player, the switches, the reason
 * line and the panel, and the reason line reads the same controller the player
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
import { useEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import * as Player from '@playdeck/react';
/*
 * ---- how the skin switch applies a real stylesheet -------------------------
 *
 * `theme` is the library's one opt-in stylesheet, and the switch has to be able
 * to apply it and take it away again without shipping it to a reader who never
 * presses the switch. Three ways were available.
 *
 * A plain `import '@playdeck/react/theme.css'` — what `HeroPlayer.astro` did —
 * is loaded for everybody and can never be removed, so `none` would be a lie.
 *
 * A dynamic `import('@playdeck/react/theme.css')` defers the cost, but Vite
 * turns a dynamically imported stylesheet into a chunk that injects a `<style>`
 * element on evaluation, and nothing hands back a handle to remove it. Pressing
 * `theme` once would make `none` unreachable for the rest of the page's life.
 *
 * `?url` is the third and is what this uses. Vite emits `theme.css` as its own
 * hashed asset and this import is the string address of it, so no byte of the
 * stylesheet is in the page's own CSS or JavaScript. The effect below appends a
 * `<link>` at `theme` and removes it at `none`, which is the same mechanism a
 * consumer's bundler performs at build time, done at a reader's request
 * instead. `none` therefore really is no CSS: no rule in the document matches a
 * `[data-playdeck-part]` element except the geometry `Bench.astro` writes, and
 * geometry is the consumer's in both positions — the library's own stylesheet
 * says so in as many words, and states only appearance.
 */
import themeHref from '@playdeck/react/theme.css?url';
import type { PlayerProvider } from '@playdeck/core';
import { benchSources } from '@/bench-sources';
import {
  buildComposition,
  type BenchPosition,
  type SkinName
} from '@/bench-composition';
import { QUIET_START, quietLine, recordLoad } from '@/bench-quiet';
import BenchSwitches from './BenchSwitches';
import CompositionPanel from './CompositionPanel';
import ReasonLine from './ReasonLine';

interface Props {
  /** `import.meta.env.BASE_URL`, read in `Bench.astro` and passed down. */
  readonly base: string;
  /**
   * The still the dormant player shows, already resolved against the site's
   * base path. A real image rather than an empty box: the frame is the largest
   * thing on the page and sits above the fold, and without it the reader's
   * first impression is a blank rectangle rather than a player waiting to be
   * pressed. `Bench.astro` records which frame of the clip it is and the
   * command that cut it.
   */
  readonly poster: string;
}

/**
 * The URL the source switch's position resolves to.
 *
 * Derived here rather than remembered separately, because `BenchPosition`
 * carries both the provider and its URL and the two must not drift:
 * `buildComposition` prints the URL and stays pure by having no opinion about
 * where one came from, so something has to hold them together and it is the
 * press that does it.
 *
 * The throw is the same shape `index.astro` uses for a missing bundle target.
 * `benchSources` is built from a `Record<PlayerProvider, …>` and is therefore
 * total, but `find` cannot say so in the type, and a silent fallback URL would
 * be a player pointed somewhere nobody chose.
 */
const sourceUrlFor = (provider: PlayerProvider, base: string): string => {
  const entry = benchSources.find(
    (candidate) => candidate.provider === provider
  );
  if (entry === undefined) {
    throw new Error(`BenchIsland: ${provider} is not a bench source.`);
  }
  return entry.source(base);
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
    fullscreen: snapshot.fullscreen
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
  return (
    /*
     * A focusable region that owns the media keyboard map — Space, the arrows,
     * `m`, `f` — and owns them only while focus is inside it.
     *
     * Each control is capability-gated by the library rather than by this page.
     * `Player.FullscreenButton` is the visible instance: it renders only while
     * the fullscreen capability reads `available`, so where fullscreen is
     * refused it is absent rather than present and dead. That is the same fact
     * the reason line under the switches prints in words.
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
      <Player.PlayButton ref={playButton}>
        {state.playing ? <Player.PauseIcon /> : <Player.PlayIcon />}
      </Player.PlayButton>
      <Player.MuteButton>
        {state.muted ? <Player.MutedIcon /> : <Player.VolumeHighIcon />}
      </Player.MuteButton>
      <Player.SeekSlider />
      <Player.Time type="current" />
      <Player.Time type="duration" />
      <Player.FullscreenButton>
        {state.fullscreen ? (
          <Player.FullscreenExitIcon />
        ) : (
          <Player.FullscreenEnterIcon />
        )}
      </Player.FullscreenButton>
    </Player.Controls>
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
  skin
}: {
  readonly poster: string;
  readonly skin: SkinName;
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
     * `data-bench-skin` is what scopes `Bench.astro`'s one appearance reset to
     * the `none` position. It rides on the viewport rather than on
     * `.bench__stage` because the viewport is React's: the attribute then
     * arrives in the same commit as the state it reports, where writing it onto
     * the Astro element would mean a `setAttribute` in an effect and a frame in
     * which the document and the switch disagree.
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
       * announce the same thing twice to a reader who cannot see either. */}
      <Player.Poster>
        <Player.PosterImage alt="" src={poster} />
      </Player.Poster>
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
 * It is live because a static one stops being true. "Nothing above has loaded"
 * is exact until somebody presses play, and then it is a false sentence printed
 * directly under the thing that falsified it — on a page whose whole argument is
 * that its statements can be checked.
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
 * The cross-origin states are unreachable today, because every hosted provider
 * in `bench-sources.ts` is still `ready: false`. They are written as the general
 * rule rather than as speculation: the test is the source's origin against this
 * page's own, not a provider's name, so they stay correct the day those three
 * clips exist and need no edit to become live.
 */
const QuietLine = ({ sourceUrl }: { readonly sourceUrl: string }) => {
  const [history, setHistory] = useState(QUIET_START);

  // `'dormant'` alone, and not `'eligible'` beside it. `useActivation`'s
  // `activate` sets `'eligible'` as its first act after the press, once the
  // load is committed — so a snapshot carrying it means the reader has already
  // asked and something is already on its way. Erring to that side is
  // deliberate: this line must never be later than the request it describes.
  const loading = Player.usePlayerState(
    (snapshot) => snapshot.activation !== 'dormant'
  );

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
   * printing "no request has left this page" for a frame after one has —
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
 * The one line of what the mounted provider refused, wired to the live
 * controller.
 *
 * One selector for both values rather than two hooks, for the reason
 * `ControlBar` reads one: `usePlayerState` compares what it selected, so this
 * component wakes when a capability moves and sits still through the clock.
 *
 * `ReasonLine` decides whether there is anything to print, and returns `null`
 * when there is not. Nothing here holds space for it and nothing here wraps it,
 * which is what keeps the resting placeholder the design removed unwritable.
 */
const Report = () => {
  const { provider, capabilities } = Player.usePlayerState((snapshot) => ({
    provider: snapshot.provider,
    capabilities: snapshot.capabilities
  }));
  return <ReasonLine capabilities={capabilities} provider={provider} />;
};

/**
 * Where the stage actually lands: not here, but inside the frame
 * `Bench.astro` draws above this island.
 *
 * The mount element is read once, lazily. This component is `client:only`, so
 * the function body runs in a browser already holding the page's full static
 * markup, mount element included, and there is nothing to wait on with an
 * effect. A lookup that failed would mean `Bench.astro` stopped rendering the
 * element, which is a defect this line is not the place to guard against.
 */
const StagePortal = ({
  poster,
  skin
}: {
  readonly poster: string;
  readonly skin: SkinName;
}) => {
  const [mount] = useState(() => document.getElementById('bench-stage'));
  if (mount === null) return null;
  return createPortal(<Stage poster={poster} skin={skin} />, mount);
};

const BenchIsland = ({ base, poster }: Props) => {
  const [position, setPosition] = useState<BenchPosition>({
    source: 'native',
    sourceUrl: sourceUrlFor('native', base),
    skin: 'none'
  });

  // The skin, applied and removed as a real `<link>` — see the import above
  // for why that rather than an import of either kind. The cleanup is what
  // makes `none` mean what it says.
  useEffect(() => {
    if (position.skin !== 'theme') return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = themeHref;
    document.head.append(link);
    return () => {
      link.remove();
    };
  }, [position.skin]);

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
      defaultMuted
    >
      <StagePortal poster={poster} skin={position.skin} />
      <QuietLine sourceUrl={position.sourceUrl} />
      {/* The readout: the switches and what the provider answered on one side,
       * the composition they built on the other, stacked below 48rem. The
       * reason line sits under the switches rather than in its own row, so the
       * column beside it never moves when one arrives. */}
      <div className="grid items-start gap-[var(--space-6)] md:grid-cols-2">
        <div className="grid gap-[var(--space-4)]">
          <BenchSwitches
            onSkin={(skin: SkinName) =>
              setPosition((current) => ({ ...current, skin }))
            }
            onSource={(source) =>
              setPosition((current) => ({
                ...current,
                source,
                sourceUrl: sourceUrlFor(source, base)
              }))
            }
            skin={position.skin}
            source={position.source}
          />
          <Report />
        </div>
        <CompositionPanel composition={buildComposition(position)} />
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
