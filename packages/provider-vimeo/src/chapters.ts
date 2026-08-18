import type {
  Availability,
  Chapter,
  PlayerCapabilities,
  ProviderStatePatch
} from '@playdeck/core';
import { chaptersEqual, deriveChapters } from '@playdeck/core';
import {
  available,
  noChapterSource,
  type EmitProviderState,
  type IsStalePlayer
} from './adapter-values.js';
import type { VimeoSdkChapter, VimeoSdkPlayer } from './loader.js';

// The SDK's `index` is 1-based and stable for the video, so it makes the id.
// The array position stands in for an entry that arrives without one.
const vimeoChapterId = (chapter: VimeoSdkChapter, position: number): string =>
  Number.isFinite(chapter.index)
    ? `vimeo:${chapter.index}`
    : `vimeo:${position}`;

// An embed that does not implement `getChapters` still answers it, so what
// comes back is not guaranteed to be a list of chapters at all. Same rule the
// quality ladder follows: a shape we cannot vouch for is dropped, not guessed
// at. An entry without a start or a title is dropped for the same reason —
// publishing it would put `undefined` in the collection.
const toVimeoChapters = (value: unknown): ReadonlyArray<VimeoSdkChapter> =>
  Array.isArray(value)
    ? (value as ReadonlyArray<VimeoSdkChapter>).filter(
        (chapter) =>
          Number.isFinite(chapter?.startTime) &&
          typeof chapter.title === 'string'
      )
    : [];

// The slice of the player this seam drives: the chapter list and the duration
// the last chapter is closed with, nothing else.
export type VimeoChaptersPlayer = Pick<
  VimeoSdkPlayer,
  'getChapters' | 'getDuration'
>;

export type VimeoChaptersDeps = {
  readonly emit: EmitProviderState;
  readonly isStale: IsStalePlayer;
  // The host's capabilities snapshot, which folds this seam's own availability
  // in with the others'.
  readonly getCapabilities: () => PlayerCapabilities;
};

// The chapters seam: the published collection and the capability facet beside
// it. Vimeo reports a start and a title per chapter and no end at all, so the
// end times here are `@playdeck/core`'s derivation, exactly as they are on the
// native path.
export type VimeoChapters = {
  // Adopts the list read at attach, returning the patch fragment the
  // attachment seam folds into its ready state. What the SDK answered is
  // untrusted in shape, not merely in success, so this takes `unknown`.
  readonly adopt: (
    chapters: unknown,
    duration: number | null
  ) => ProviderStatePatch;
  readonly handlers: {
    // Vimeo fires this when the chapter under the playhead changes. It is the
    // documented signal that chapter data is live, and re-reading the list from
    // it is what keeps the published collection current without polling.
    readonly onChapterChange: (player: VimeoChaptersPlayer) => void;
  };
  // Drops the adopted list; called on teardown, so a retry inherits nothing.
  readonly reset: () => void;
  // The `chapters` facet of the host's capabilities.
  readonly chaptersAvailability: () => Availability;
};

export const createVimeoChapters = ({
  emit,
  isStale,
  getCapabilities
}: VimeoChaptersDeps): VimeoChapters => {
  let chapters: readonly Chapter[] = Object.freeze([]);
  let chaptersAvailability: Availability = noChapterSource;

  // The one place an SDK answer becomes the published collection, so it is the
  // one place the coercion has to run: the attach read and the `chapterchange`
  // refresh both arrive here.
  const publish = (
    raw: unknown,
    duration: number | null
  ): readonly Chapter[] => {
    chapters = deriveChapters(
      toVimeoChapters(raw).map((chapter, position) => ({
        id: vimeoChapterId(chapter, position),
        title: chapter.title,
        startTime: chapter.startTime
      })),
      duration
    );
    chaptersAvailability = chapters.length > 0 ? available : noChapterSource;
    return chapters;
  };

  return {
    adopt: (raw, duration) => ({ chapters: publish(raw, duration) }),
    handlers: {
      onChapterChange: (player) => {
        const previous = chapters;
        void Promise.all([
          player.getChapters(),
          player.getDuration().catch((): null => null)
        ]).then(
          ([raw, duration]) => {
            if (isStale(player)) return;
            publish(raw, duration);
            if (chaptersEqual(previous, chapters)) return;
            emit({ chapters, capabilities: getCapabilities() });
          },
          () => undefined
        );
      }
    },
    reset: () => {
      chapters = Object.freeze([]);
      chaptersAvailability = noChapterSource;
    },
    chaptersAvailability: () => chaptersAvailability
  };
};
