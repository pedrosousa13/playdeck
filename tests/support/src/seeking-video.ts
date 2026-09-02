// A media element that reports a `currentTime` write back through the events a
// seek fires, shared by the native and HLS provider tests. It models the
// reporting, and where the write lands; it does not model the `seekable` clamp,
// `duration`, or anything else the seek algorithm does.
//
// happy-dom's `currentTime` is a plain field: a write moves the playhead and
// fires nothing. HTML has a write start a seek that reports itself later —
// `seeking`, then a `timeupdate` for the new position, then `seeked` — and a
// provider that corrects the playhead from its own `timeupdate` handler is
// therefore re-entered by the correction it just issued. That re-entry is
// invisible against an element that stays silent.
//
// A write arriving while a seek is outstanding replaces it, and the replaced
// seek never reports a `seeked`. This is what leaves `seeking` raised on a
// player that keeps correcting: the last seek of the run is always the one that
// was interrupted.
export type SeekingVideo = {
  readonly media: HTMLVideoElement;
  // Every position written through the setter, in order, as requested rather
  // than as landed. Recorded rather than counted so a test asserts where the
  // playhead was asked to go, and cannot pass against an element that was never
  // written to at all.
  readonly writes: number[];
  // Moves the playhead the way decoding does: no write, no seek events. This is
  // how a test puts the element past a boundary before delivering the
  // `timeupdate` that reports it.
  readonly place: (seconds: number) => void;
  // Runs outstanding seeks to completion, including any the reports provoke.
  // A player that settles empties this; one that does not is cut off at the
  // step limit, with its last seek still outstanding.
  readonly settle: () => void;
};

// Enough steps to tell a single correction from a player that never settles,
// and few enough to stop a runaway from taking the whole test run with it.
const SETTLE_STEP_LIMIT = 10;

export const createSeekingVideo = (
  // Where the element ends up for a requested position, which is not always
  // where it was asked to go: the seek algorithm clamps the target into
  // `seekable` and engines snap it to a frame boundary. `trackPosition` in
  // `provider-native/test/index.test.ts` carries the measurement, and takes the
  // same parameter for the same reason — named `landsAt` here only because
  // `settle` is already the name of this fixture's seek pump. The default
  // honours the request, which is what a test that does not care assumes.
  landsAt: (requested: number) => number = (requested) => requested
): SeekingVideo => {
  const media = document.createElement('video');
  const writes: number[] = [];
  let playhead = 0;
  let seekOutstanding = false;
  Object.defineProperty(media, 'currentTime', {
    configurable: true,
    get: () => playhead,
    set: (seconds: number) => {
      writes.push(seconds);
      playhead = landsAt(seconds);
      seekOutstanding = true;
    }
  });
  return {
    media,
    writes,
    place: (seconds) => {
      playhead = seconds;
    },
    settle: () => {
      for (let step = 0; seekOutstanding && step < SETTLE_STEP_LIMIT; step++) {
        seekOutstanding = false;
        media.dispatchEvent(new Event('seeking'));
        media.dispatchEvent(new Event('timeupdate'));
        if (seekOutstanding) continue;
        media.dispatchEvent(new Event('seeked'));
      }
    }
  };
};
