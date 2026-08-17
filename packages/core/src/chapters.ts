import type { Chapter } from './types.js';

// What a provider can actually report: a name and where it begins. Everything
// else about a `Chapter` is derived here.
export type ChapterInput = {
  readonly id: string;
  readonly title: string;
  readonly startTime: number;
};

// Turns what a provider reports into the published collection, so every
// provider publishes the same shape. Ordered by ascending `startTime`, and each
// chapter ends where the next one begins.
//
// The last chapter is the case worth stating: it has no next start, so it takes
// the media duration — and `null` when the duration is unknown or not finite,
// which a live stream and a source without metadata both are. `Infinity` is
// deliberately not substituted: it would read as an end that is known.
export const deriveChapters = (
  chapters: ReadonlyArray<ChapterInput>,
  duration: number | null | undefined
): readonly Chapter[] => {
  const ordered = [...chapters].sort(
    (left, right) => left.startTime - right.startTime
  );
  const mediaEnd =
    typeof duration === 'number' && Number.isFinite(duration) ? duration : null;
  return Object.freeze(
    ordered.map(({ id, startTime, title }, index) =>
      Object.freeze({
        id,
        title,
        startTime,
        endTime: ordered[index + 1]?.startTime ?? mediaEnd
      })
    )
  );
};

// Whether two published collections say the same thing — what an adapter checks
// before publishing a change, so a duration report that moves nothing publishes
// nothing.
export const chaptersEqual = (
  left: readonly Chapter[],
  right: readonly Chapter[]
): boolean =>
  left.length === right.length &&
  left.every((chapter, index) => {
    const other = right[index];
    return (
      other !== undefined &&
      chapter.id === other.id &&
      chapter.title === other.title &&
      chapter.startTime === other.startTime &&
      chapter.endTime === other.endTime
    );
  });
