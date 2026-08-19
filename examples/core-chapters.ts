import { chaptersEqual, deriveChapters } from '@playdeck/core';

// A provider reports where a chapter begins and what it is called. Nothing
// reports where one ends, so `deriveChapters` is what decides: the list is
// ordered by `startTime`, and each chapter ends where the next one begins.
export const chapters = deriveChapters(
  [
    { id: 'ch2', title: 'The build', startTime: 132 },
    { id: 'ch1', title: 'Introduction', startTime: 0 }
  ],
  248
);

// -> 132. The last chapter takes the media duration, so this reads 248.
export const firstEnd = chapters[0]?.endTime;

// An unknown or endless duration leaves the last chapter open. `null`, never
// `Infinity`: an end nobody knows must not read as one somebody does.
export const openEnded = deriveChapters(
  [{ id: 'ch1', title: 'Live', startTime: 0 }],
  null
).at(-1)?.endTime;

// An adapter publishes `chapters` only when the collection changes — a
// duration report that moves nothing publishes nothing. This is that test.
export const closed = !chaptersEqual(
  chapters,
  deriveChapters([{ id: 'ch1', title: 'Introduction', startTime: 0 }], null)
);
