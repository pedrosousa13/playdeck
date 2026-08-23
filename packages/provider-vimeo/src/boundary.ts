import { createTimeBoundary } from '@playdeck/core';

// The fields of the host's options the boundary is resolved from. `loop` is
// here because the two settings only mean something together: the same end
// boundary either publishes `ended` or restarts, depending on it.
export type VimeoBoundaryOptions = {
  readonly loop?: boolean;
  readonly startTime?: number;
  readonly endTime?: number;
};

// The `[startTime, endTime]` seam: the sanitised window plus the mutable state
// the playback seam needs to enforce it — whether the adapter has already
// published `ended` at the end boundary, whether the attachment has been
// positioned yet (which arms the wrap guard), and a token that makes a deferred
// loop restart inert once another one has opened.
//
// Vimeo expresses a start as a load hint only and has no end mechanism at all,
// so every decision here is the adapter's. The arithmetic is `@playdeck/core`'s,
// shared with the other embeds so all three read one window the same way.
export type VimeoBoundary = {
  readonly loop: boolean;
  // Where playback starts, and where a loop restart returns to. Zero when no
  // start was configured, or when it sanitised away.
  readonly start: (duration: number | null) => number;
  // Clamps a requested seek into the window, replacing the plain
  // `[0, duration]` clamp.
  readonly clamp: (duration: number | null, time: number) => number;
  // Where the window ends once the duration is known — the time a boundary end
  // pins the playhead mirror to.
  readonly end: (duration: number | null) => number | undefined;
  // True when a time report has reached the end boundary. Always false with no
  // `endTime`: the natural end of the media stays Vimeo's own event to report.
  readonly atEnd: (duration: number | null, time: number) => boolean;
  // True when Vimeo's own `loop=1` wrapped the playhead behind the start
  // boundary. Gated on the attachment being positioned, so the time reports a
  // load emits before the initial seek do not read as a wrap.
  readonly wrapped: (duration: number | null, time: number) => boolean;
  // Where a position the adapter did not ask for has to be moved to for the
  // window to hold, or undefined when it needs no move — `@playdeck/core`'s
  // shared `correction`, which the YouTube and Wistia ports consult too. It is
  // what makes the start boundary a floor rather than something `adopt` applies
  // once (#381), and it answers the end of the window as well: a report past
  // the end says how far the embed ran on before the pause landed.
  //
  // Gated on the attachment being positioned, for the reason the wrap guard is:
  // the reports a load emits before the initial seek are a player still
  // loading, and correcting them would fight `adopt`'s own seek.
  readonly correction: (
    duration: number | null,
    time: number
  ) => number | undefined;
  // Whether the player's own `ended` is one this seam has to correct rather
  // than publish. `@playdeck/core`'s shared gate, where the reasoning and the
  // declared divergence from native both live; the YouTube and Wistia ports
  // ask it the same question.
  readonly restartsOnEnded: () => boolean;
  // Whether an end has been published and not yet retired — this window's, or
  // the embed's own. It suppresses the pause that follows, and it is what makes
  // the next `play()` replay from the start boundary.
  readonly hasEnded: () => boolean;
  readonly setEnded: (ended: boolean) => void;
  // Arms the boundary for a freshly adopted player, discarding the state (and
  // any deferred restart) of the one a retry replaced.
  readonly adopt: () => void;
  // Opens a loop restart and returns its token; the deferred resume checks the
  // token back in before touching the player.
  readonly openRestart: () => number;
  readonly isRestartCurrent: (token: number) => boolean;
};

export const createVimeoBoundary = (
  options: VimeoBoundaryOptions
): VimeoBoundary => {
  const bounds = createTimeBoundary(options);
  const loop = options.loop ?? false;
  let boundaryEnded = false;
  let positioned = false;
  let restartToken = 0;

  return {
    loop,
    start: (duration) => bounds.start(duration),
    clamp: (duration, time) => bounds.clamp(duration, time),
    end: (duration) => bounds.end(duration),
    atEnd: (duration, time) => bounds.atEnd(duration, time),
    wrapped: (duration, time) =>
      bounds.atWrap(duration, time, { loop, positioned }),
    correction: (duration, time) =>
      positioned ? bounds.correction(duration, time) : undefined,
    restartsOnEnded: () => bounds.restartsAtStart(loop),
    hasEnded: () => boundaryEnded,
    setEnded: (ended) => {
      boundaryEnded = ended;
    },
    adopt: () => {
      boundaryEnded = false;
      positioned = true;
      ++restartToken;
    },
    openRestart: () => ++restartToken,
    isRestartCurrent: (token) => token === restartToken
  };
};
