import type { PlayerQuality } from '@playdeck/core';
import * as Player from '@playdeck/react';
import { useEffect, useRef, useState, type ReactElement } from 'react';

/**
 * The reference composition: one player assembled only from public
 * `@playdeck/react` / `@playdeck/core` exports. It is the runnable proof behind
 * criterion 8 of #1, and the artifact #32 points axe and its keyboard flows at.
 *
 * Icons are supplied here, by the consumer, and never defaulted by the
 * primitives — that keeps every icon opt-in and tree-shakeable (#31 task 2).
 * Accessible names come from each primitive's own `aria-label`, not from these
 * children.
 */

// The same resolver as `stories/asset-url.ts`, restated here because this
// directory may not import from outside itself. The fixtures below are served
// from the workbench's own base path, which is `/` on the dev server and under
// Vitest and `/playdeck/` on the hosted build — a root-absolute literal 404s
// there (#435). `import.meta.env.BASE_URL` is Vite's name for that prefix and
// always ends in a slash; it is not part of the primitives' API, and a consumer
// copying this file writes their own URLs here.
const assetUrl = (path: string) => `${import.meta.env.BASE_URL}${path}`;

// Layout, plus the slider appearance the unmounted theme would otherwise have
// supplied (#191). `@playdeck/react/theme.css` is deliberately not mounted: the
// only per-story way to mount it reaches into `packages/`, which this directory
// may not do, and a plain side-effect import would leak the theme into every
// other story's document.
const layoutCss = `
/* This whole block is one JS template literal (it is delimited by the
   backtick right above). Do not put a backtick anywhere in here, including
   markdown-style code-quoting in a comment - it silently closes the string
   early and breaks the build with no warning at this line. */
/* Controls that depend on how much room the PLAYER has query this, not the
   viewport: an embedded player in a narrow column then gets the same
   treatment as a narrow phone, which a viewport media query cannot express.

   The container is this wrapper, not the player. An element is never matched
   by its own container query, so with container-type on .playdeck-example the box
   could not restyle itself — which is how aspect-ratio ended up stranded on a
   viewport media query while the rules it is paired with fired on the
   container (#114). The cqw unit below needs an ancestor container for the
   same reason. max-width lives here so container width and player width are
   the same number at every viewport; on the player it would leave the
   container measuring the full page above 768px. */
.playdeck-example-frame {
  width: 100%;
  max-width: 48rem;
  container-type: inline-size;
}
.playdeck-example {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  background: #0b0e13;
  color: #e8edf4;
  font-family: system-ui, sans-serif;
}
/* The standard [hidden] reset, and it needs !important here rather than by
   habit: playdeck's overlay primitives carry their own inline display (Captions
   is display: flex from captionsOverlayStyle), and a non-important stylesheet
   rule cannot beat an inline one. Without this, hidden is inert on exactly
   the parts #89 needs it on. */
.playdeck-example [hidden] {
  display: none !important;
}
.playdeck-example-controls {
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
.playdeck-example-row {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}
.playdeck-example-row-buttons {
  flex-wrap: wrap;
}
.playdeck-example-scrubber {
  flex: 1 1 auto;
  min-width: 0;
}
.playdeck-example-spacer {
  flex: 1 1 auto;
}
.playdeck-example [data-playdeck-part='time'] {
  flex: 0 0 auto;
  font-variant-numeric: tabular-nums;
  font-size: 0.8125rem;
}
/* Sliders. Both halves of #191 (which absorbed #192) live here, because both
   are the same omission: the primitives hand these parts geometry and nothing
   else. SeekSlider gives the buffered container no box at all, and each range
   inside it position: absolute plus an inline-axis left/width pair - so
   untouched they are 0px-tall transparent boxes. The two range inputs get a
   target floor and nothing else, and not the same floor: VolumeSlider is
   itself the input and takes both axes (minWidth and minHeight 44), while the
   seek input takes minHeight 44 alone, with no minWidth, plus a width: 100%.
   Untouched, both are whatever bare native slider the engine draws.

   Thickness and colour follow packages/react/theme.css, which this story still
   does not mount for the reasons at the top of this file. It is the source of
   truth to copy from, not to import - and nothing here is added back to it.

   Copied in the var(--token, fallback) form the theme writes, not as the
   resolved literal. The toolbar Theme toggle DOES apply to this story, and
   theme.css ships inside @layer playdeck (ADR-0001), so these unlayered rules beat
   it: written as literals, these would be the only parts of the composition
   deaf to the token channel with the toggle on. Every fallback here is the
   theme's own, so unthemed rendering is unchanged.

   Vertical margins are deliberately left alone, unlike the theme, which zeroes
   them. The native range input carries a 2px UA margin on every engine, and
   that margin is part of what both control rows are currently sized by, so
   zeroing it would shrink both - and this change is not allowed to move them.
   It is the whole story only for the button row (measured on chromium: 48px =
   the 44px target floor plus the two margins). The seek row is taller than
   that margin box - 50px on chromium, 52px on firefox - because SeekSlider's
   root is a block box whose only in-flow child is the inline-level input, so
   its height is a line box: the root's own strut hangs its descent below the
   input's baseline. That residue is engine font metrics, which nothing here
   sets. e2e/reference.spec.ts pins the criterion by deleting these rules from
   the live sheet and re-measuring, rather than by naming either number. */
.playdeck-example [data-playdeck-part='seek-buffered'] {
  position: absolute;
  inset-inline: 0;
  inset-block-start: 50%;
  block-size: var(--playdeck-slider-thickness, 0.25rem);
  translate: 0 -50%;
  border-radius: calc(var(--playdeck-slider-thickness, 0.25rem) / 2);
  background-color: var(--playdeck-color-track, rgb(255 255 255 / 0.3));
  /* Absolute here and static on the input next to it, so this layer paints
     ABOVE the control it describes no matter the DOM order - a stacking
     context paints its in-flow content before its positioned descendants.
     pointer-events is therefore load-bearing rather than tidy: without it the
     layer swallows the seek it is drawn to describe. */
  pointer-events: none;
}
/* No position: absolute here. SeekSlider already sets it inline on every range
   (ADR-0001), and an inline value cannot be beaten from a stylesheet anyway, so
   restating it would be dead CSS. inset-block and the two paint properties are
   NOT inline, which is why they are. */
.playdeck-example [data-playdeck-part='seek-buffered-range'] {
  inset-block: 0;
  border-radius: inherit;
  background-color: var(--playdeck-color-buffered, rgb(255 255 255 / 0.5));
}
.playdeck-example [data-playdeck-part='seek-slider-input'],
.playdeck-example [data-playdeck-part='volume-slider'] {
  accent-color: var(--playdeck-color-accent, #3ea6ff);
  background-color: transparent;
  cursor: pointer;
}
/* An explicit size rather than the UA default, which is not even the same
   number across engines (measured: 129px on chromium, 160px on firefox).
   flex: 0 0 auto matches the buttons in this row: the row wraps rather than
   squeezes, so nothing in it should shrink below its own target size. */
.playdeck-example [data-playdeck-part='volume-slider'] {
  flex: 0 0 auto;
  inline-size: 5rem;
}
/* Forced colours replaces both background-colors above with the same system
   canvas, which would collapse the buffered layer back into one flat invisible
   band - the very defect being fixed, for the users least able to absorb it.
   The same outlined-track/filled-range treatment the shipped theme gives these
   parts. The range inputs need no counterpart: nothing above hand-rolls a
   thumb or a track, so they keep the UA own forced-colors handling. */
@media (forced-colors: active) {
  .playdeck-example [data-playdeck-part='seek-buffered'] {
    border: 1px solid canvastext;
    background-color: canvas;
  }
  .playdeck-example [data-playdeck-part='seek-buffered-range'] {
    background-color: canvastext;
  }
}
.playdeck-example button {
  flex: 0 0 auto;
  background: transparent;
  border: none;
  border-radius: 4px;
  color: inherit;
  cursor: pointer;
  font-size: 1.125rem;
}
.playdeck-example button:hover {
  background: rgba(232, 237, 244, 0.16);
}
/* Opens upward from the trigger, which is the right placement wherever there is
   room above it — and often there is not. The trigger sits in a control bar
   that can be almost the whole player: measured at a 320px browser viewport, a
   154px bar inside a 162px box leaves 66px above the trigger for a menu that
   wants 202, so the box was placed 124px above the top of the DOCUMENT, where
   nothing reaches it — the page does not scroll (scrollHeight equals
   clientHeight) and overflow-y below only moves content inside a box that is
   itself off-screen (#413).

   No rule here can tell that, and the reason is worth stating: what the menu
   needs is the distance from its trigger up to the top of the player, and CSS
   has no way to ask for it. max-height bounds how tall the box is, not where it
   is put. A percentage measures the containing block, which is the trigger's own
   44px wrapper (SettingsMenu sets position: relative inline). A cq unit measures
   the container's width. None of the three moves with the trigger.

   A width breakpoint is not a stand-in either, and that was measured rather than
   assumed: the placement fails wherever the button row wraps, which is as much a
   function of text size as of width. Off the top of the document at 320, 375 and
   420; again from 440 through 500, where the row wraps a second time; and again
   at 640 with text at 200%, at -164. So the correction is measured at runtime in
   ReferencePlayer below and written back as an inline translate, plus a
   max-height on the box this rule makes a scroller.
   This rule is the placement that correction starts from, and stays untouched
   wherever the menu already fits — every width at or above 520 with text at
   100%, the visual baseline in e2e/visual.spec.ts among them. */
.playdeck-example-menu {
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
.playdeck-example-menu [data-playdeck-part='menu-radio-item'],
.playdeck-example-menu [data-playdeck-part='menu-item'] {
  justify-content: flex-start;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
  text-align: left;
}
.playdeck-example-error {
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

   No :has(.playdeck-example-controls[hidden]) guard any more. It existed because
   aspect-ratio: auto collapsed the box to zero height in the states where #89
   hides the row (pre-activation, and while an error surface owns the
   viewport), taking the full-bleed overlay down with it — measured as an
   activation button that could not be clicked. min-height holds the box open
   in exactly those states, so there is nothing left to guard. */
@container (max-width: 420px) {
  .playdeck-example {
    aspect-ratio: auto;
    min-height: 56.25cqw;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
  }
  .playdeck-example-controls {
    position: relative;
  }
  .playdeck-example-volume {
    display: none;
  }
  .playdeck-example-fold {
    display: none;
  }
}
/* The other half of the fold. Both forms are always rendered and the container
   query hides whichever does not apply — display: none takes the inactive one
   out of the accessibility tree too, so neither width offers the same action
   twice. 421px, not 420px: the breakpoint above is inclusive.

   Written as a descendant selector to match the specificity of the menu item
   styling above, which sets display: flex at (0,2,0). A bare
   .playdeck-example-menu-fold is (0,1,0) and silently loses to it — measured, as
   a PiP entry that stayed visible next to the PiP button at 768px. */
@container (min-width: 421px) {
  .playdeck-example-menu .playdeck-example-menu-fold {
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
      <Player.SettingsMenuContent className="playdeck-example-menu">
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
            className="playdeck-example-menu-fold"
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
            className="playdeck-example-menu-fold"
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
  /**
   * Opt the shortcut layer onto `document` instead of the controls region.
   * Exists so one story composes the mode WCAG 2.1.4 actually constrains
   * (#181) — the region-scoped default is exempt under the active-on-focus
   * exception, so scanning it proves nothing about the global one.
   */
  readonly globalShortcuts?: boolean;
};

export const ReferencePlayer = ({
  globalShortcuts,
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

  // #413. The stylesheet opens both menus upward from their trigger, and where
  // that does not fit it puts the box outside the player and off the top of the
  // document, with items nothing can reach. The comment on
  // `.playdeck-example-menu` above carries why no rule can decide this: the one
  // quantity the placement depends on — how far the trigger is below the top of
  // the player — is not a quantity CSS can read. So it is measured here and
  // written back, which is what a positioning library would do for a consumer
  // that reached for one.
  //
  // Two corrections, in this order: bound the box to the Viewport's height,
  // then slide whatever still hangs over its top edge back down. Together they
  // keep the menu inside the Viewport, which is the boundary that matters
  // rather than the browser viewport — `.playdeck-example` is `overflow:
  // hidden`, so an item outside it is painted nowhere even when its rect is
  // on-screen.
  //
  // Found by part rather than by class, so the CaptionsMenu preset's content is
  // covered as well: it renders `SettingsMenuContent` itself and takes no
  // className from here. That is also why the height bound is conditional. A
  // bound costs reachability nothing only where the box can scroll to what the
  // bound cuts off, and only the settings menu can: `.playdeck-example-menu`
  // carries `overflow-y: auto`, the captions menu takes no className from here
  // and so computes `overflow-y: visible` (measured). Bounding that one would
  // clip items with no way to reach them — the very unreachability #413 is
  // about. So the computed value is read and a non-scroller keeps its natural
  // height, with only the shift applied to it. The limit that leaves is real
  // and cannot be papered over here: a non-scrolling menu taller than the
  // Viewport still cannot fit inside it. Today none is — the captions menu is a
  // static, in-flow box in the control row with one text track — and giving it
  // the composition's scrolling presentation is a separate change.
  //
  // Both properties are cleared before measuring, so each pass reads the
  // stylesheet's own placement rather than the previous pass's answer and can
  // run as often as it likes. Neither is written back when the menu already
  // fits, which is why nothing changes above the widths where it does not.
  const frameRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const frame = frameRef.current;
    if (frame === null) return undefined;
    const fit = (): void => {
      const menus = frame.querySelectorAll<HTMLElement>(
        '[data-playdeck-part="settings-menu"]'
      );
      if (menus.length === 0) return;
      const viewport = frame.querySelector('[data-playdeck-part="viewport"]');
      if (viewport === null) return;
      const bounds = viewport.getBoundingClientRect();
      for (const menu of menus) {
        menu.style.maxHeight = '';
        menu.style.translate = '';
        const natural = menu.getBoundingClientRect();
        const style = globalThis.getComputedStyle(menu);
        // Only a box that scrolls may be shortened: see above.
        const scrolls =
          style.overflowY === 'auto' || style.overflowY === 'scroll';
        const height = scrolls
          ? Math.min(natural.height, bounds.height)
          : natural.height;
        if (height < natural.height) {
          // `max-height` applies to the content box here — nothing in this
          // composition resets `box-sizing` — so the menu's own padding and
          // border have to come off any height written back to it. The computed
          // `height` is the used content height, so the difference is exactly
          // that chrome, whether or not the box is currently bounded.
          const chrome = natural.height - Number.parseFloat(style.height);
          menu.style.maxHeight = `${height - chrome}px`;
        }
        // The box is anchored at its bottom, so bounding its height moves its
        // top down by the same amount. What is left over is the shift.
        const shift = Math.max(bounds.top - (natural.bottom - height), 0);
        if (shift > 0) menu.style.translate = `0 ${shift}px`;
      }
    };
    // A menu exists in the DOM only while it is open (`SettingsMenuContent`
    // renders null otherwise), so mounting one is a child-list mutation. The
    // callback is a microtask, which runs before the frame is painted — the
    // corrected box is the first one drawn, not a second one after a flash.
    const opened = new MutationObserver(fit);
    opened.observe(frame, { childList: true, subtree: true });
    // And the room can change under an open menu. What is observed is the
    // frame, the size container the room is a function of: the Viewport is its
    // only child and is `width: 100%` over a locked ratio, so the two are the
    // same box (measured at 320 and at 400, closed and with either menu open —
    // 288x162, 288x199, 368x207), and the frame's inline size is also what the
    // `@container` fold in the stylesheet above keys off, which decides how many
    // entries the settings menu has. Every change to the room above a trigger
    // therefore passes through it.
    //
    // Observing it is only safe because a pass cannot resize it. `translate`
    // never affects layout, and the one menu a pass gives a `max-height` to is
    // `position: absolute`, so its height reaches nothing outside itself
    // (measured: bounding it fires neither a frame nor a Viewport observer,
    // while doing the same to the in-flow captions menu fires both — that menu
    // is left alone for the reason above, which closes this loop as well).
    //
    // That leaves one gap — a text-size change at a width where the Viewport is
    // ratio-locked resizes the menu without resizing the frame — which no test
    // covers and which the next open corrects.
    const resized = new ResizeObserver(fit);
    resized.observe(frame);
    return () => {
      opened.disconnect();
      resized.disconnect();
    };
  }, []);

  return (
    <>
      <style>{layoutCss}</style>
      <div className="playdeck-example-frame" ref={frameRef}>
        <Player.Viewport className="playdeck-example">
          <Player.Poster>
            <Player.PosterImage
              alt=""
              src={assetUrl('poster.svg')}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          </Player.Poster>
          <Player.Media textTracks={textTracks} />
          <Player.LoadingIndicator />
          {/* The default child is a literal "Retry" text button; the example
              renders icons everywhere, so it supplies the render prop. */}
          <Player.ErrorDisplay className="playdeck-example-error">
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
            className="playdeck-example-controls"
            global={globalShortcuts}
            hidden={overlayOwnsViewport}
          >
            <div className="playdeck-example-row">
              <Player.Time type="current" />
              <div className="playdeck-example-scrubber">
                <Player.SeekSlider />
              </div>
              <Player.Time type="duration" />
            </div>
            <div className="playdeck-example-row playdeck-example-row-buttons">
              <Player.PlayButton>
                {state.playing ? <Player.PauseIcon /> : <Player.PlayIcon />}
              </Player.PlayButton>
              <Player.MuteButton>
                {state.muted ? <Player.MutedIcon /> : <Player.VolumeHighIcon />}
              </Player.MuteButton>
              <Player.VolumeSlider className="playdeck-example-volume" />
              <span className="playdeck-example-spacer" />
              <Player.CaptionsButton>
                <Player.CaptionsIcon />
              </Player.CaptionsButton>
              {/* Default children: CaptionsMenu's own trigger already renders
                  CaptionsIcon, not a text label. */}
              <Player.CaptionsMenu />
              <ExampleSettingsMenu />
              <Player.PipButton className="playdeck-example-fold">
                {state.pictureInPicture ? (
                  <Player.PipExitIcon />
                ) : (
                  <Player.PipEnterIcon />
                )}
              </Player.PipButton>
              <Player.AirPlayButton className="playdeck-example-fold">
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
  // Two containers for one clip, MP4 first, and the ordering is the whole
  // point: an engine with an H.264 decoder takes the MP4 and nothing about this
  // example changes, while one without it falls through to the WebM instead of
  // failing.
  //
  // That second case is not hypothetical and is not a decode failure. A
  // Playwright Linux WebKit answers `''` for `avc1`, so it rejects an
  // `<source type="video/mp4">` during source selection and never issues a
  // request for it at all (`networkState` 3, `currentSrc` empty). A bare
  // `tracer.mp4` string source is stamped `video/mp4` from its extension
  // (`packages/core/src/source-detection.ts`), so it gave that engine exactly
  // one candidate and it was the one it would not take: the composition then
  // sat at `activation: 'loading-provider'` forever with its whole control row
  // `hidden`, and every e2e test over this story failed on the arrangement.
  // A `<source>` set is what the media element already has for this, and
  // declaring one is also the API #15 shipped for.
  {
    id: 'local',
    label: 'Local',
    source: {
      type: 'video',
      sources: [
        { src: assetUrl('tracer.mp4'), mimeType: 'video/mp4' },
        { src: assetUrl('tracer.webm'), mimeType: 'video/webm' }
      ]
    }
  },
  {
    id: 'hls',
    label: 'HLS',
    source: { type: 'hls', src: assetUrl('hls/master.m3u8') }
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

// Only the local clip needs a declared <track>; HLS carries its subtitles in the
// manifest and the iframe providers expose their own. Declaring children on
// Media at all is the API #15 shipped without.
//
// `captions-reference.vtt`, not `captions-en.vtt`: this example's own fixture
// carries two cues with a boundary at 0.7s, inside the ~1s clip, so a cue
// transition actually happens during real playback here (#32's e2e
// announcement-policy test needs one to fall inside its observation window).
// `captions-en.vtt` stays a single 0-5s cue for the other stories/specs that
// use it (`fixtures-playerfixture--captions-*`, driven by
// `e2e/captions.spec.ts`) — this file is scoped to the reference example only.
const localTextTracks: Player.MediaProps['textTracks'] = [
  {
    src: assetUrl('captions-reference.vtt'),
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
  const [active, setActive] = useState<(typeof sources)[number]['id']>('local');
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
          textTracks={current.id === 'local' ? localTextTracks : undefined}
        />
      </Player.Root>
    </>
  );
};
