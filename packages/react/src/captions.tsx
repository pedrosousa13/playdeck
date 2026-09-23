import type { TextCue, TextTrack } from '@playdeck/core';
import { CaptionsIcon } from './icons.js';
import { controlTargetStyle, visuallyHiddenStyle } from './loading-error.js';
import { useActiveCues, usePlayer, usePlayerState } from './player-context.js';
import {
  MenuRadioGroup,
  MenuRadioItem,
  SettingsMenu,
  SettingsMenuContent,
  SettingsMenuTrigger
} from './settings-menu.js';
import { assignRef } from './viewport-media.js';
import {
  useCallback,
  useLayoutEffect,
  useRef,
  type ComponentPropsWithRef,
  type CSSProperties,
  type ReactNode
} from 'react';

export type CaptionsProps = Omit<ComponentPropsWithRef<'div'>, 'children'> & {
  readonly renderCue?: (cue: TextCue) => ReactNode;
};

// User-themeable CSS custom properties consumed by the default cue text box
// below. Set these on `Player.Captions` (or an ancestor) to theme the
// overlay without overriding its structure:
//   --playdeck-caption-font-size  - cue text font size (default: 1.05rem)
//   --playdeck-caption-color      - cue text color (default: #fff)
//   --playdeck-caption-background - cue text box background (default: rgba(0, 0, 0, 0.75))
//   --playdeck-caption-edge       - cue text edge, a text-shadow value (default: none)
const captionsOverlayStyle: CSSProperties = {
  position: 'absolute',
  left: 0,
  right: 0,
  bottom: 0,
  zIndex: 20,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: '0.3em',
  paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 1.2em)',
  paddingLeft: 'env(safe-area-inset-left, 0px)',
  paddingRight: 'env(safe-area-inset-right, 0px)',
  pointerEvents: 'none'
};

const captionCueBoxStyle: CSSProperties = {
  fontSize: 'var(--playdeck-caption-font-size, 1.05rem)',
  color: 'var(--playdeck-caption-color, #fff)',
  backgroundColor: 'var(--playdeck-caption-background, rgba(0, 0, 0, 0.75))',
  textShadow: 'var(--playdeck-caption-edge, none)',
  padding: '0.15em 0.4em',
  borderRadius: '0.2em'
};

// Strips a cue down to its public shape before handing it to consumer code
// (renderCue), so engine-only fields on a provider's cue objects never leak.
const normalizeCue = (cue: TextCue): TextCue => ({
  id: cue.id,
  startTime: cue.startTime,
  endTime: cue.endTime,
  text: cue.text
});

const isRenderableCue = (cue: TextCue): boolean =>
  typeof cue?.text === 'string' && cue.text.trim().length > 0;

const defaultCueRenderer = (cue: TextCue): ReactNode =>
  cue.text.split('\n').map((line, index) => (
    <div data-playdeck-part="caption-line" key={index}>
      {line}
    </div>
  ));

// The clearance between the lifted overlay and the control row's own top
// edge (#760's "with a small gap"). A plain constant rather than a token: the
// gap is not something a theme has ever needed to tune, and IDLE_DELAY_MS in
// viewport-media.tsx makes the same call for the same reason.
const CONTROLS_CLEARANCE_PX = 8;
const CONTROLS_CLEARANCE_TRANSITION_MS = 150;

// Read once per mount, matching player-controller.ts's own prefersReducedMotion:
// a viewer who flips the OS setting mid-session is honoured by the next
// player that mounts, not retroactively by one already running.
const prefersReducedMotion = (): boolean => {
  if (
    typeof window === 'undefined' ||
    typeof window.matchMedia !== 'function'
  ) {
    return false;
  }
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

// Whether the control row is actually painted, read off the row itself
// rather than inferred from `data-idle`. `data-idle` only ever means "no
// pointer or keyboard input recently" (Contract.mdx's own wording) -- it says
// nothing about whether anything is hiding the row on that basis, and
// `docked.css` never reads it at all, so its bar stays fully opaque forever.
// Inferring "hidden" from the attribute alone un-lifted the cue onto a
// docked bar that had never actually faded, which is #760 all over again
// under the one theme that never hides. Reading the row's own computed
// style instead gives the right answer under all three cases this package
// ships: always `true` for `docked.css` and for an unthemed row (neither
// ever sets `opacity` or `visibility` off of `data-idle`), and exactly
// `theme.css`'s own fade for the themed row, `:focus-within` override
// included -- that CSS rule already decides visibility correctly, so this
// reads its answer rather than re-deriving it.
const isPainted = (element: HTMLElement): boolean => {
  const style = getComputedStyle(element);
  return style.opacity !== '0' && style.visibility !== 'hidden';
};

/**
 * Lifts the whole cue overlay clear of the control row's own top edge while
 * the row is shown, so an opaque cue background can never paint over a
 * control, whatever that background is (#760, "lift the cue above the bar").
 * The move is a plain `transform`, computed from the row's OWN measured
 * rect rather than any fixed height, so it holds under either shipped theme,
 * the headless reference composition, every viewport this package tests
 * (including the phone media query, which shrinks the row) and however many
 * lines the row wraps into.
 *
 * `Captions` and `Controls` are independent siblings wherever a consumer
 * composes them -- neither primitive has a reference to the other -- so the
 * control row is found by its part, through the nearest `viewport` ancestor
 * both share. Absent either one, there is nothing to clear and the cue stays
 * exactly where the CSS default (`captionsOverlayStyle`'s own
 * `paddingBottom`) already puts it. A `MutationObserver` on the viewport's
 * own child list keeps that true even when `Controls` is not there yet at
 * mount, or is mounted and unmounted later: `attach`/`detach` run again
 * whenever the row it finds changes, not only once at the top of the effect.
 */
const useLiftAboveControls = (
  overlayRef: { readonly current: HTMLDivElement | null },
  // Whether the overlay div is mounted this render -- `captionRendering ===
  // 'custom'`. `overlayRef.current` itself is not a valid dependency (a ref
  // mutation is not a re-render), so remounting is driven by this instead,
  // the one thing that actually toggles the div in and out of the tree.
  active: boolean
): void => {
  // A layout effect, not a passive one: this measures the row and paints a
  // position from it, and `Root`'s own `armedAutoplayMode` effect makes the
  // same call for the same reason -- a passive effect runs after the browser
  // has already painted once, which is exactly the one frame a first-mount
  // measurement must not show the cue sitting unlifted in.
  useLayoutEffect(() => {
    if (!active) return;
    const overlay = overlayRef.current;
    const viewport = overlay?.closest<HTMLElement>(
      '[data-playdeck-part="viewport"]'
    );
    if (!overlay || !viewport) return;

    // Bound to whichever row is currently attached, and rebuilt by `sync`
    // below whenever that changes -- so a row that mounts after this effect,
    // unmounts, or is replaced is always the one being measured.
    let detach: (() => void) | undefined;
    let attached: HTMLElement | undefined;

    const attachTo = (controls: HTMLElement): (() => void) => {
      const update = (): void => {
        if (!isPainted(controls)) {
          overlay.style.transform = '';
          return;
        }
        const controlsRect = controls.getBoundingClientRect();
        if (controlsRect.width === 0 || controlsRect.height === 0) {
          overlay.style.transform = '';
          return;
        }
        const viewportRect = viewport.getBoundingClientRect();
        const shift =
          viewportRect.bottom - controlsRect.top + CONTROLS_CLEARANCE_PX;
        overlay.style.transform = shift > 0 ? `translateY(${-shift}px)` : '';
      };

      // Placed once with no transition registered yet, and the transition
      // is enabled only after: a fresh attachment has no prior position to
      // move from, and setting `transition` and `transform` together in the
      // same style recalculation animates from the implicit `none`, which is
      // a flaky, partial lift rather than an instant, correct one.
      update();
      overlay.style.transition = `transform ${
        prefersReducedMotion()
          ? '0.01ms'
          : `${CONTROLS_CLEARANCE_TRANSITION_MS}ms`
      } ease`;

      const resizeObserver =
        typeof ResizeObserver === 'function'
          ? new ResizeObserver(update)
          : undefined;
      resizeObserver?.observe(controls);
      // `data-idle` flipping is what starts (or, read directly, IS) a themed
      // row's own opacity change, so reacting to it here catches a fade-out
      // as soon as it begins: `getComputedStyle` read synchronously at that
      // point still reports the pre-transition value (still visible), which
      // is the right, conservative answer for the whole of that fade -- the
      // lift only has to let go once the row has actually finished fading,
      // which `transitionend` below reports.
      const idleObserver =
        typeof MutationObserver === 'function'
          ? new MutationObserver(update)
          : undefined;
      idleObserver?.observe(viewport, {
        attributes: true,
        attributeFilter: ['data-idle']
      });
      // A fade-IN reads the opposite way at the same instant: synchronously
      // at `transitionrun`, `getComputedStyle` still reports the PRE-
      // transition value too, which for that direction is the wrong,
      // still-hidden answer. Deferred one animation frame, the row has
      // actually started animating and reads a non-zero opacity, so the lift
      // catches up within a frame instead of waiting the whole fade out.
      // `transitionend` needs no such defer: it already fires after the
      // browser has committed the transition's final value.
      const onTransitionRun = (): void => {
        if (typeof requestAnimationFrame === 'function') {
          requestAnimationFrame(update);
        } else {
          update();
        }
      };
      controls.addEventListener('transitionrun', onTransitionRun);
      controls.addEventListener('transitionend', update);
      viewport.addEventListener('focusin', update);
      viewport.addEventListener('focusout', update);
      return () => {
        resizeObserver?.disconnect();
        idleObserver?.disconnect();
        controls.removeEventListener('transitionrun', onTransitionRun);
        controls.removeEventListener('transitionend', update);
        viewport.removeEventListener('focusin', update);
        viewport.removeEventListener('focusout', update);
      };
    };

    const sync = (): void => {
      const found =
        viewport.querySelector<HTMLElement>(
          '[data-playdeck-part="controls"]'
        ) ?? undefined;
      if (found === attached) return;
      detach?.();
      detach = undefined;
      attached = found;
      if (found) {
        detach = attachTo(found);
      } else {
        overlay.style.transform = '';
      }
    };

    sync();
    // `subtree: true` because `Controls` is not guaranteed to be a direct
    // child of `Viewport` -- a consumer's own wrapper is enough to miss it
    // under `childList` alone. The callback itself stays cheap (one
    // `querySelector` plus a reference check that bails immediately once
    // attached), so the extra mutations this also sees -- a cue's own text
    // updates elsewhere in the same viewport -- cost one comparison each,
    // not a re-measure.
    const mountObserver =
      typeof MutationObserver === 'function'
        ? new MutationObserver(sync)
        : undefined;
    mountObserver?.observe(viewport, { childList: true, subtree: true });

    return () => {
      mountObserver?.disconnect();
      detach?.();
    };
  }, [active, overlayRef]);
};

export const Captions = ({
  ref,
  renderCue,
  style,
  ...props
}: CaptionsProps) => {
  const captionRendering = usePlayerState((state) => state.captionRendering);
  const cues = useActiveCues();
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const setRef = useCallback(
    (node: HTMLDivElement | null) => {
      overlayRef.current = node;
      return assignRef(ref, node);
    },
    [ref]
  );
  useLiftAboveControls(overlayRef, captionRendering === 'custom');
  if (captionRendering !== 'custom') return null;

  return (
    <div
      {...props}
      data-playdeck-part="captions"
      data-state="custom"
      ref={setRef}
      style={{ ...captionsOverlayStyle, ...style }}
    >
      {cues.filter(isRenderableCue).map((cue, index) => {
        const normalized = normalizeCue(cue);
        return (
          <div
            data-playdeck-part="caption-cue"
            key={`${normalized.id ?? ''}:${normalized.startTime}:${normalized.endTime}:${index}`}
            style={renderCue ? undefined : captionCueBoxStyle}
          >
            {renderCue ? renderCue(normalized) : defaultCueRenderer(normalized)}
          </div>
        );
      })}
    </div>
  );
};

/**
 * Resolves what a captions toggle (button click or `C` shortcut) should do
 * next, given the current tracks/selection and the last non-null selection
 * remembered across toggles. Returns `null` to turn captions off, a track id
 * to turn them on, or `undefined` when there is nothing to select (no
 * remembered or first track) — the caller should no-op in that case.
 */
export const resolveCaptionToggle = (
  textTracks: readonly TextTrack[],
  selectedId: string | null,
  rememberedId: string | null
): string | null | undefined => {
  if (selectedId !== null) return null;
  return textTracks.find((t) => t.id === rememberedId)?.id ?? textTracks[0]?.id;
};

export type CaptionsButtonProps = ComponentPropsWithRef<'button'>;

export const CaptionsButton = ({
  'aria-label': ariaLabel,
  children,
  onClick,
  style,
  ...props
}: CaptionsButtonProps) => {
  const { provider, selectedId, status, textTracks } = usePlayerState(
    (state) => ({
      provider: state.provider,
      selectedId: state.selectedTextTrackId,
      status: state.capabilities.selectTextTrack.status,
      textTracks: state.textTracks
    })
  );
  const { controller, lastSelectedTextTrackId } = usePlayer();
  // One-time announcement: track the previously seen selection so the live
  // region text only changes (and is only announced) on an actual
  // transition, not on every unrelated re-render.
  const previousSelectedId = useRef<string | null>(selectedId);
  const announcement = useRef<string>('');
  /* eslint-disable react-hooks/refs -- computed synchronously per render so the announcement updates on the same render as the transition. */
  if (previousSelectedId.current !== selectedId) {
    const label = textTracks.find((t) => t.id === selectedId)?.label;
    announcement.current =
      selectedId !== null ? `${label ?? ''} captions on` : 'Captions off';
    previousSelectedId.current = selectedId;
  }
  const announcementText = announcement.current;
  /* eslint-enable react-hooks/refs */
  if (status !== 'available') return null;
  const on = selectedId !== null;

  return (
    <>
      <button
        {...props}
        // The live region below is untouched by the consumer's name: it
        // announces the transition, not the control, and is the library's own
        // sentence either way.
        aria-label={ariaLabel ?? (on ? 'Disable captions' : 'Enable captions')}
        aria-pressed={on}
        data-provider={provider ?? undefined}
        data-playdeck-part="captions-button"
        data-state={on ? 'on' : 'off'}
        onClick={(event) => {
          onClick?.(event);
          if (event.defaultPrevented) return;
          const next = resolveCaptionToggle(
            textTracks,
            selectedId,
            lastSelectedTextTrackId.current
          );
          if (next !== undefined) void controller.selectTextTrack(next);
        }}
        style={{ ...controlTargetStyle, ...style }}
        type="button"
      >
        {children ?? <CaptionsIcon />}
      </button>
      {/* Announces only the control-change message ("<label> captions on" /
          "Captions off"); cue text must never enter a live region. */}
      <div
        aria-live="polite"
        data-playdeck-part="captions-announcer"
        style={visuallyHiddenStyle}
      >
        {announcementText}
      </div>
    </>
  );
};

// Disambiguates tracks that share a label (e.g. two "English" tracks with
// different kinds) by appending the language, rather than always showing it.
const disambiguateTrackLabel = (
  track: TextTrack,
  tracks: readonly TextTrack[]
): string => {
  const sharesLabel =
    tracks.filter((candidate) => candidate.label === track.label).length > 1;
  if (!sharesLabel || !track.language) return track.label;
  return `${track.label} (${track.language})`;
};

export type CaptionsMenuProps = ComponentPropsWithRef<'div'>;

/**
 * Preset assembly over `SettingsMenu`/`MenuRadioGroup`: lists the current
 * text tracks plus an "Off" option. Pass children to fully customize the
 * trigger/content; omit them to get the default track list.
 */
export const CaptionsMenu = ({ children, ...props }: CaptionsMenuProps) => {
  const { selectedId, status, textTracks } = usePlayerState((state) => ({
    selectedId: state.selectedTextTrackId,
    status: state.capabilities.selectTextTrack.status,
    textTracks: state.textTracks
  }));
  const { controller } = usePlayer();
  if (status !== 'available' || textTracks.length === 0) return null;

  return (
    <SettingsMenu {...props}>
      {children ?? (
        <>
          <SettingsMenuTrigger aria-label="Captions">
            <CaptionsIcon />
          </SettingsMenuTrigger>
          <SettingsMenuContent>
            <MenuRadioGroup
              onValueChange={(value) => {
                void controller.selectTextTrack(value === '' ? null : value);
              }}
              value={selectedId ?? ''}
            >
              <MenuRadioItem value="">Off</MenuRadioItem>
              {textTracks.map((track) => (
                <MenuRadioItem key={track.id} value={track.id}>
                  {disambiguateTrackLabel(track, textTracks)}
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </SettingsMenuContent>
        </>
      )}
    </SettingsMenu>
  );
};
