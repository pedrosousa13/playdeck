/*
 * The hero's two instruments, composed from the published primitives and
 * nothing else: the player, and the ledger of what that player reports about
 * the browser it is running in.
 *
 * This file is the site's whole React surface, and the hero is the only place
 * on the site that hydrates anything. It is here because the page's central
 * claim — that no provider request leaves the page before a click, and that
 * what a player says it can do is true — is a claim about behaviour, and the
 * honest way to make it on a landing page is to run the thing that behaves
 * that way rather than to describe it in a paragraph above a still image.
 *
 * ---- why one file holds both panels -----------------------------------------
 *
 * `Player.Root` renders no DOM at all: it is two context providers around its
 * children. So one root can stand above two panels that sit side by side on the
 * page, and the ledger reads the same controller the player is driven by rather
 * than a second one of its own. That is the whole architecture, and it is what
 * makes the panel a report rather than an illustration — there is no other
 * controller for a row to be reading.
 *
 * Both panels are therefore produced here, including their markup, and both are
 * grid items of `.hero__stage` in `src/pages/index.astro`: an `<astro-island>`
 * is `display: contents`, so what this renders lands in that grid directly.
 * `HeroPlayer.astro` keeps every rule that decides how they look, and carries
 * why those rules are written the way they are.
 *
 * `source` arrives as a prop rather than being written here, because the URL a
 * page serves the clip from is resolved against `import.meta.env.BASE_URL` in
 * the Astro component, the way every other address on this site is.
 */
import { useEffect, useRef, type RefObject } from 'react';
import * as Player from '@playdeck/react';

interface Props {
  /** The clip's URL, already resolved against the site's base path. */
  readonly source: string;
}

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
 * bar of words is the wrong register for a hero on a site set in one
 * typographic system. Passing an icon means passing both halves of the pair,
 * because a control whose label stops tracking its state is worse than the
 * words were: the accessible name is the library's and follows the state, so
 * the glyph beside it has to follow it too.
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
   * document. The library restores focus for its own capability-gated controls
   * — `Player.Controls` refocuses its region when a control unmounts from
   * inside it — but the activation button is outside that region, so nothing
   * catches this one. Left alone, a reader who pressed Enter is standing on
   * nothing: no ring, and no media shortcut, because `shortcuts` is not
   * `global` and Space belongs to `Player.Controls` only while focus is inside
   * it. So they would have to Tab back into the page to work the thing they
   * just started.
   *
   * The play button is where they land, because it is the same command they
   * just gave. It is a real control, it is visible, and it is the first stop in
   * the bar, so Tab from there walks the rest.
   *
   * Only for a keyboard press. `fromKeyboardRef` is written by the activation
   * button from the browser's own answer to "was the ring showing" — a pointer
   * press leaves no `:focus-visible` — because moving focus after a click would
   * put a ring on screen that the reader did not ask for, and that is its own
   * defect rather than a fix for this one.
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
     * `m`, `f` — and owns them only while focus is inside it. Focus enters and
     * leaves it by Tab like any other group of buttons, so nothing here holds
     * on to it.
     *
     * Each control is capability-gated by the library rather than by this page.
     * `Player.FullscreenButton` is the visible instance: it renders only while
     * the fullscreen capability reads `available`, so where fullscreen is
     * refused it is absent rather than present and dead. That is the thesis at
     * the top of this page, running.
     *
     * Hidden until the activation has produced a player, which is the mirror of
     * the affordance's own render condition — the bar arrives exactly as the
     * button leaves. Playback is the one command with no capability to gate on,
     * so before a provider is attached the play control would be present and
     * inert: the shape this page's opening sentence argues against.
     * `hidden` rather than a conditional render, because it takes the row out
     * of layout, out of the accessibility tree and out of the tab order at
     * once, and does it without unmounting a subtree that is about to come
     * back.
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
 * What a click on the picture does once the clip is running: toggle playback,
 * which is the platform convention every desktop player follows.
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
 * removes itself at exactly the moment this appears.
 *
 * `tabIndex={-1}` because this is a pointer target and not a second control.
 * A tab stop here would put a second thing named "Pause" in front of the bar
 * without offering anything the bar's own `Player.PlayButton` does not. What
 * makes that safe is not that the keyboard has other routes to the command
 * already — at the moment of activation it has none, which is why `ControlBar`
 * moves focus into the bar — but that once focus is in the bar there are two:
 * the bar's play button, and Space or `k` anywhere inside `Player.Controls`.
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

/*
 * The five rows, in the order the panel prints them. They are the capabilities
 * a viewer of a video can tell apart by looking — can this go fullscreen, can
 * it pop out, can it be sent to a television, can the picture be chosen, can
 * the subtitles be — rather than the whole of `PlayerCapabilities`, which also
 * carries entries about seeking and volume that no browser refuses.
 *
 * A tuple of literals, so `snapshot.capabilities[capability]` below is checked
 * against the published state's own shape and a renamed capability is a type
 * error here rather than a row that quietly reads `undefined`.
 */
const capabilityRows = [
  'fullscreen',
  'pictureInPicture',
  'airPlay',
  'selectQuality',
  'selectTextTrack'
] as const;

interface LedgerRowProps {
  readonly capability: (typeof capabilityRows)[number];
  /** The attached provider, or `null` while none is. */
  readonly provider: string | null;
}

/**
 * One capability, as the live controller currently answers for it.
 *
 * Every value on screen is read here, through the published selector hook, from
 * the state of the controller `Player.Root` created above. Nothing is timed,
 * seeded or assumed: before the activation button is pressed the root is
 * dormant, no provider has been asked anything, and each row says exactly that
 * — `unknown`, because the answer is not known, with `not-ready` under it
 * saying why it is not. A panel that hid that state, or guessed past it, would
 * be the one dishonest thing on a page arguing that a player's own report is
 * worth trusting.
 *
 * A component per row rather than one selector over all five, because
 * `usePlayerState` compares what it selected: an `Availability` is a small
 * plain object, so a row re-renders when its own answer changes and sits still
 * while another row's moves.
 *
 * The reason line is rendered whenever the state carries one, which is both of
 * the two answers that qualify themselves — `unknown` and `unavailable` — and
 * never for `available`, which has nothing left to qualify. It prints whatever
 * reason the state holds rather than matching against a list of the ones this
 * page happens to know about: `Availability` in `@playdeck/core` is the
 * authority on that set, and a page with its own copy of it would print nothing
 * at all the day a new member is added.
 */
const LedgerRow = ({ capability, provider }: LedgerRowProps) => {
  const availability = Player.usePlayerState(
    (snapshot) => snapshot.capabilities[capability]
  );
  // The context for the answer, in the order a reader needs it: which provider
  // answered, then what it said. Both are optional — there is no provider until
  // one attaches, and `available` carries no reason — so the line is assembled
  // rather than formatted, and is absent entirely when it would be empty.
  const detail: string[] = [];
  if (provider !== null) detail.push(provider);
  if ('reason' in availability) detail.push(availability.reason);
  return (
    <li className="row" data-status={availability.status}>
      <span className="row__dot" aria-hidden="true" />
      <span className="row__capability">{capability}</span>
      <span className="row__status">{availability.status}</span>
      {detail.length === 0 ? null : (
        <span className="row__reason">{detail.join(' · ')}</span>
      )}
    </li>
  );
};

/**
 * The panel, and the site's most on-thesis element: what the player beside it
 * reports about the browser this page is open in, now.
 *
 * The provider is read once here rather than in each row, because it is one
 * fact about the player and not five: every row's context line names the same
 * attached provider.
 *
 * An `h2` at the caption rung, kept because the panel is a named region of the
 * page a reader can navigate to — see `HeroPlayer.astro` for the size.
 */
const Ledger = () => {
  const provider = Player.usePlayerState((snapshot) => snapshot.provider);
  return (
    <figure className="ledger">
      <div className="ledger__panel">
        <h2 className="ledger__title">Capability ledger</h2>
        <ul className="ledger__rows">
          {capabilityRows.map((capability) => (
            <LedgerRow
              capability={capability}
              key={capability}
              provider={provider}
            />
          ))}
        </ul>
      </div>
      <figcaption className="ledger__caption">
        Read from the player beside it, in this browser, as it answers. Every
        row opens <code>unknown</code>: nothing has been asked of a provider
        until the clip is loaded.
      </figcaption>
    </figure>
  );
};

const HeroPlayerIsland = ({ source }: Props) => {
  /*
   * How the activation was given, carried from the press to the render that
   * replaces the button — a ref rather than state, because nothing renders
   * from it and a re-render here would be a re-render of the whole player.
   *
   * `:focus-visible` is the test rather than a modality guess of this file's
   * own. It is the browser's own record of whether this element was showing a
   * focus ring at the moment it was pressed, which is exactly the question:
   * a ring that was already on screen may move, and one that was not must not
   * appear. Enter and Space on a focused button match it; a mouse click and a
   * touch tap do not.
   */
  const fromKeyboardRef = useRef(false);
  return (
    /*
     * `loading="interaction"` is the prop the Providers section below the hero
     * argues from, used here for real: the root stays dormant until the
     * activation affordance is pressed, so the clip is not fetched and no
     * provider is attached before that press. A hero that preloaded its media
     * while the page said nothing loads before a click would be the one thing on
     * this page contradicting the page.
     *
     * It also settles `prefers-reduced-motion` without a branch of its own.
     * Nothing moves until a reader asks it to, so there is no motion to suppress
     * for a reader who asked to see none — and the optional theme collapses the
     * opacity transitions its own controls carry under that query already.
     *
     * `defaultMuted` is the uncontrolled form: the player opens silent and then
     * owns the value, so `Player.MuteButton` can hand it back. The clip carries
     * no audio track at all, which makes the muting belt-and-braces rather than
     * load-bearing — but a hero that could make noise on a click is worth
     * closing off at the prop rather than at the media.
     */
    <Player.Root loading="interaction" source={source} defaultMuted>
      {/*
       * The player panel: a raised body holding a recessed screen. The same two
       * boxes the ledger below is built from, because the two are the halves of
       * one claim — the thing running, and what it reports about itself — and a
       * page that drew them as unrelated panels would be hiding that.
       *
       * The bezel and the stage are here rather than in `HeroPlayer.astro`
       * because `Player.Root` has to stand above both panels, and an Astro
       * component cannot be a child of a React one. What that costs is the
       * reservation `HeroPlayer.astro`'s stage used to make before the island
       * mounted; `index.astro` makes it on the empty island instead, and says
       * so where it does it.
       */}
      <figure className="demo">
        <div className="demo__bezel">
          <div className="demo__stage">
            <Player.Viewport>
              <Player.Media />
        {/*
         * Before the control bar and after the picture, which is the order the
         * stacking in `HeroPlayer.astro` reads: at equal `z-index` the later
         * sibling paints in front, so the bar's own buttons stay on top of this
         * and keep their clicks.
         */}
        <SurfaceToggle />
        {/*
         * The affordance that starts everything. It is a real `<button>` from
         * the library, so it is reachable by Tab and answers Enter, and it takes
         * the site's own focus ring: `base.css` styles `:focus-visible` by
         * element rather than by class, and nothing here opts out of it.
         *
         * Named rather than left to the built-in "Play", because this button
         * both loads and plays and the name has to say the first part. Its
         * children are the icon, so the name stands alone rather than
         * disagreeing with a word printed beside it.
         *
         * It is also the whole picture and not the badge drawn on it, and that
         * is the library's own default rather than something added here: the
         * button ships `position: absolute; inset: 0` with auto margins, so it
         * is full-bleed until a stylesheet gives it a size. The bundled theme
         * gives it 4rem, and `HeroPlayer.astro` takes that back and redraws the
         * badge as a background, so a click anywhere on the stage loads and
         * plays — one control, one accessible name, no second click target.
         */}
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
          </div>
        </div>
        <figcaption className="demo__caption">
          A real player, composed from the published primitives. The clip is a
          one-second test pattern served from this origin, and{' '}
          <code>loading="interaction"</code> holds the player dormant until the
          button is pressed — so nothing is fetched, and no provider is attached,
          before that press.
        </figcaption>
      </figure>
      <Ledger />
    </Player.Root>
  );
};

/*
 * The default export is what the island loader resolves: Astro looks the
 * component up by export name and that name defaults to `default`. The
 * declaration above keeps its own name anyway, because an anonymous default is
 * what React reports in a stack trace and in the devtools tree.
 *
 * Named exports are this repository's rule wherever a package publishes a
 * surface. This file publishes none — it has one consumer, `HeroPlayer.astro` —
 * so the rule that applies is the loader's.
 */
export default HeroPlayerIsland;
