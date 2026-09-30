import type { Chapter } from '@playdeck/core';
import { formatTime } from './format-time.js';
import { usePlayer, usePlayerState } from './player-context.js';
import {
  MenuRadioGroup,
  MenuRadioItem,
  SettingsMenu,
  SettingsMenuContent,
  SettingsMenuTrigger
} from './settings-menu.js';
import type { ComponentPropsWithRef } from 'react';

// The published collection is contiguous and ascending by `startTime`
// (`deriveChapters`, `packages/core/src/chapters.ts`): the current one is
// simply the last chapter that has begun -- the one with the greatest
// `startTime` not past `currentTime`. `null` while `currentTime` is before
// every chapter's own start, which a collection whose first entry does not
// start at 0 can leave true for a moment.
const currentChapter = (
  chapters: readonly Chapter[],
  currentTime: number
): Chapter | null =>
  chapters.reduce<Chapter | null>(
    (current, chapter) =>
      chapter.startTime <= currentTime &&
      (current === null || chapter.startTime > current.startTime)
        ? chapter
        : current,
    null
  );

export type ChaptersMenuProps = ComponentPropsWithRef<'div'>;

/**
 * Preset assembly over `SettingsMenu`/`MenuRadioGroup`: lists the published
 * chapters (`PlayerState.chapters`), each rung showing its title and start
 * time, and marks the one containing the current playback position.
 * Selecting a rung seeks to that chapter's start time. Renders nothing until
 * `capabilities.chapters` resolves `available`, or while the published list
 * is empty.
 */
export const ChaptersMenu = ({ children, ...props }: ChaptersMenuProps) => {
  const { chapters, currentChapterId, status } = usePlayerState((state) => ({
    chapters: state.chapters,
    currentChapterId:
      currentChapter(state.chapters, state.currentTime)?.id ?? null,
    status: state.capabilities.chapters.status
  }));
  const { controller } = usePlayer();
  if (status !== 'available' || chapters.length === 0) return null;

  return (
    <SettingsMenu {...props}>
      {children ?? (
        <>
          {/* No dedicated chapters icon exists, so this relies on
              SettingsMenuTrigger's own fallback -- `{children ?? <SettingsIcon
              />}` in settings-menu.tsx -- the same way QualityMenu and
              PlaybackRateMenu do for the identical case. */}
          <SettingsMenuTrigger aria-label="Chapters" />
          <SettingsMenuContent>
            <MenuRadioGroup
              onValueChange={(value) => {
                const chapter = chapters.find(
                  (candidate) => candidate.id === value
                );
                if (chapter) {
                  void controller.seekToWithOrigin(chapter.startTime, 'user');
                }
              }}
              value={currentChapterId ?? ''}
            >
              {chapters.map((chapter) => (
                <MenuRadioItem key={chapter.id} value={chapter.id}>
                  {chapter.title} · {formatTime(chapter.startTime)}
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </SettingsMenuContent>
        </>
      )}
    </SettingsMenu>
  );
};
