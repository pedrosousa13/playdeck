import type { TextCue, TextTrack } from '@reely/core';
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
import {
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
//   --reely-caption-font-size  - cue text font size (default: 1.05rem)
//   --reely-caption-color      - cue text color (default: #fff)
//   --reely-caption-background - cue text box background (default: rgba(0, 0, 0, 0.75))
//   --reely-caption-edge       - cue text edge, a text-shadow value (default: none)
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
  fontSize: 'var(--reely-caption-font-size, 1.05rem)',
  color: 'var(--reely-caption-color, #fff)',
  backgroundColor: 'var(--reely-caption-background, rgba(0, 0, 0, 0.75))',
  textShadow: 'var(--reely-caption-edge, none)',
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
    <div data-reely-part="caption-line" key={index}>
      {line}
    </div>
  ));

export const Captions = ({ renderCue, style, ...props }: CaptionsProps) => {
  const captionRendering = usePlayerState((state) => state.captionRendering);
  const cues = useActiveCues();
  if (captionRendering !== 'custom') return null;

  return (
    <div
      {...props}
      data-reely-part="captions"
      data-state="custom"
      style={{ ...captionsOverlayStyle, ...style }}
    >
      {cues.filter(isRenderableCue).map((cue, index) => {
        const normalized = normalizeCue(cue);
        return (
          <div
            data-reely-part="caption-cue"
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
        aria-label={on ? 'Disable captions' : 'Enable captions'}
        aria-pressed={on}
        data-provider={provider ?? undefined}
        data-reely-part="captions-button"
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
        data-reely-part="captions-announcer"
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
