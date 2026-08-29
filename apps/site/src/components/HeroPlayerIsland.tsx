/*
 * The hero's player, composed from the published primitives and nothing else.
 *
 * This file is the site's whole React surface, and the hero is the only place
 * on the site that hydrates anything. It is here because the page's central
 * claim — that no provider request leaves the page before a click — is a claim
 * about behaviour, and the honest way to make it on a landing page is to run
 * the thing that behaves that way rather than to describe it in a paragraph
 * above a still image.
 *
 * Everything visual belongs to `HeroPlayer.astro`: the box, the caption, and
 * the `--playdeck-*` values the optional theme reads. This file is the
 * composition and the source, so the two questions a reader brings here — what
 * is mounted, and what it is pointed at — are answered by the markup below
 * without a stylesheet in the way.
 *
 * `source` arrives as a prop rather than being written here, because the URL a
 * page serves the clip from is resolved against `import.meta.env.BASE_URL` in
 * the Astro component, the way every other address on this site is.
 */
import * as Player from '@playdeck/react';

interface Props {
  /** The clip's URL, already resolved against the site's base path. */
  readonly source: string;
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
const ControlBar = () => {
  const state = Player.usePlayerState((snapshot) => ({
    activation: snapshot.activation,
    playing: snapshot.playback === 'playing',
    muted: snapshot.muted,
    fullscreen: snapshot.fullscreen
  }));
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
    <Player.Controls hidden={state.activation !== 'ready'}>
      <Player.PlayButton>
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
 * The keyboard already has two routes to the same command — the bar's own
 * `Player.PlayButton`, and Space or `k` anywhere inside `Player.Controls` — so
 * a tab stop here would put a second thing named "Pause" in front of the bar
 * without offering anything the bar does not. The affordance that must stay
 * reachable by Tab is the activation button, and it does.
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

const HeroPlayerIsland = ({ source }: Props) => (
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
      <Player.ActivationButton aria-label="Load and play the sample clip">
        <Player.PlayIcon />
      </Player.ActivationButton>
      <ControlBar />
    </Player.Viewport>
  </Player.Root>
);

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
