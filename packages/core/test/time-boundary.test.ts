// @vitest-environment node

import { describe, expect, test } from 'vitest';
import { createTimeBoundary } from '../src/index';

describe('startTime sanitisation', () => {
  test.each<[string, number | undefined, number]>([
    ['undefined', undefined, 0],
    ['zero', 0, 0],
    ['negative', -1, 0],
    ['NaN', Number.NaN, 0],
    ['Infinity', Number.POSITIVE_INFINITY, 0],
    ['-Infinity', Number.NEGATIVE_INFINITY, 0],
    ['a whole second', 12, 12],
    ['a fraction', 1.5, 1.5]
  ])('resolves %s to %s', (_label, startTime, expected) => {
    expect(createTimeBoundary({ startTime }).startTime).toBe(expected);
  });
});

describe('endTime sanitisation', () => {
  test.each<[string, number | undefined, number | undefined]>([
    ['undefined', undefined, undefined],
    ['NaN', Number.NaN, undefined],
    ['Infinity', Number.POSITIVE_INFINITY, undefined],
    ['-Infinity', Number.NEGATIVE_INFINITY, undefined],
    ['zero', 0, undefined],
    ['equal to the start', 10, undefined],
    ['below the start', 9, undefined],
    ['above the start', 11, 11]
  ])('resolves %s to %s against a start of 10', (_label, endTime, expected) => {
    expect(createTimeBoundary({ startTime: 10, endTime }).endTime).toBe(
      expected
    );
  });

  test('is measured against the sanitised start, not the raw one', () => {
    // A negative start sanitises to 0, so an end of 5 is still above it.
    const boundary = createTimeBoundary({ startTime: -20, endTime: 5 });
    expect(boundary.startTime).toBe(0);
    expect(boundary.endTime).toBe(5);
  });
});

describe('end', () => {
  test.each<
    [string, number | undefined, number | null | undefined, number | undefined]
  >([
    ['no end, finite duration', undefined, 30, 30],
    ['no end, null duration', undefined, null, undefined],
    ['no end, undefined duration', undefined, undefined, undefined],
    ['no end, live duration', undefined, Number.POSITIVE_INFINITY, undefined],
    ['end, no duration', 20, undefined, 20],
    ['end inside duration', 20, 30, 20],
    ['end past duration', 40, 30, 30],
    ['end, live duration', 20, Number.POSITIVE_INFINITY, 20]
  ])('resolves %s', (_label, endTime, duration, expected) => {
    const boundary = createTimeBoundary({ startTime: 5, endTime });
    expect(boundary.end(duration)).toBe(expected);
  });
});

describe('start', () => {
  test('is the sanitised start when it sits inside the window', () => {
    const boundary = createTimeBoundary({ startTime: 5, endTime: 20 });
    expect(boundary.start(30)).toBe(5);
  });

  test('clamps a start past the duration', () => {
    const boundary = createTimeBoundary({ startTime: 50 });
    expect(boundary.start(30)).toBe(30);
  });

  test('clamps a start past a duration-clamped end', () => {
    const boundary = createTimeBoundary({ startTime: 50, endTime: 80 });
    expect(boundary.start(20)).toBe(20);
  });

  test('is the start itself when there is no effective end', () => {
    const boundary = createTimeBoundary({ startTime: 50 });
    expect(boundary.start(undefined)).toBe(50);
  });
});

describe('atEnd', () => {
  test.each<[string, number | null | undefined, number]>([
    ['no duration', undefined, 999],
    ['at the duration', 30, 30],
    ['past the duration', 30, 31]
  ])('is false with no endTime and %s', (_label, duration, time) => {
    const boundary = createTimeBoundary({ startTime: 5 });
    expect(boundary.atEnd(duration, time)).toBe(false);
  });

  test.each<[string, number, boolean]>([
    ['before the end', 19.9, false],
    ['exactly at the end', 20, true],
    ['past the end', 21, true]
  ])('is %s at %s', (_label, time, expected) => {
    const boundary = createTimeBoundary({ startTime: 5, endTime: 20 });
    expect(boundary.atEnd(30, time)).toBe(expected);
  });

  test('uses the duration-clamped end', () => {
    const boundary = createTimeBoundary({ startTime: 5, endTime: 40 });
    expect(boundary.atEnd(30, 30)).toBe(true);
    expect(boundary.atEnd(30, 29)).toBe(false);
  });
});

describe('atWrap', () => {
  const looping = { loop: true, positioned: true };

  test.each<[string, { loop: boolean; positioned: boolean }]>([
    ['not looping', { loop: false, positioned: true }],
    ['not positioned yet', { loop: true, positioned: false }]
  ])('is false while %s', (_label, state) => {
    const boundary = createTimeBoundary({ startTime: 10 });
    expect(boundary.atWrap(60, 1, state)).toBe(false);
  });

  test.each<[string, number, boolean]>([
    ['behind the start', 1, true],
    ['at the start', 10, false],
    ['inside the window', 30, false]
  ])('is %s for a playhead %s', (_label, time, expected) => {
    const boundary = createTimeBoundary({ startTime: 10 });
    expect(boundary.atWrap(60, time, looping)).toBe(expected);
  });

  test('is false with no start boundary, which is where a wrap already lands', () => {
    const boundary = createTimeBoundary({ endTime: 20 });
    expect(boundary.atWrap(60, 0, looping)).toBe(false);
  });

  // The guard compares against the duration-clamped start, not the raw one. A
  // start past the duration collapses onto it, so the position the restart
  // seeks to is not itself read as another wrap — which would restart forever.
  test('compares against the duration-clamped start', () => {
    const boundary = createTimeBoundary({ startTime: 90 });
    expect(boundary.atWrap(60, 60, looping)).toBe(false);
    expect(boundary.atWrap(60, 59, looping)).toBe(true);
  });

  test('is false when the clamped start collapses onto zero', () => {
    const boundary = createTimeBoundary({ startTime: 90 });
    expect(boundary.atWrap(0, 0, looping)).toBe(false);
  });
});

// The gate all three embed ports apply to the platform's own end-of-media
// event. It was written out three times before, which is how it drifted once.
describe('restartsAtStart', () => {
  test.each<[string, boolean, number | undefined, boolean]>([
    ['is true while looping with a start boundary', true, 10, true],
    ['is true while looping with a fractional start boundary', true, 0.5, true],
    ['is false while looping with no start boundary', true, undefined, false],
    ['is false while looping with a zero start boundary', true, 0, false],
    [
      'is false while looping with a start that sanitises away',
      true,
      -5,
      false
    ],
    ['is false when not looping, with a start boundary', false, 10, false],
    [
      'is false when not looping, with no start boundary',
      false,
      undefined,
      false
    ]
  ])('%s', (_label, loop, startTime, expected) => {
    const boundary = createTimeBoundary({ startTime });
    expect(boundary.restartsAtStart(loop)).toBe(expected);
  });

  // The gate reads the raw start, not the duration-clamped one: it decides
  // whether there is anything to correct at all, and the correction itself is
  // what clamps.
  test('is true for a start past the duration, which the restart clamps', () => {
    const boundary = createTimeBoundary({ startTime: 90 });
    expect(boundary.restartsAtStart(true)).toBe(true);
    expect(boundary.start(60)).toBe(60);
  });

  test('ignores endTime, which has its own gate in atEnd', () => {
    const boundary = createTimeBoundary({ endTime: 20 });
    expect(boundary.restartsAtStart(true)).toBe(false);
  });
});

describe('clamp', () => {
  test.each<[string, number, number]>([
    ['below the start', 1, 5],
    ['at the start', 5, 5],
    ['inside the window', 12, 12],
    ['at the end', 20, 20],
    ['past the end', 25, 20]
  ])('clamps a time %s', (_label, time, expected) => {
    const boundary = createTimeBoundary({ startTime: 5, endTime: 20 });
    expect(boundary.clamp(30, time)).toBe(expected);
  });

  test('has no upper bound with no endTime and no duration', () => {
    const boundary = createTimeBoundary({ startTime: 5 });
    expect(boundary.clamp(undefined, 9999)).toBe(9999);
  });

  test('clamps to the duration with no endTime', () => {
    const boundary = createTimeBoundary({ startTime: 5 });
    expect(boundary.clamp(30, 9999)).toBe(30);
  });

  test('clamps to the effective end when the start is past it', () => {
    const boundary = createTimeBoundary({ startTime: 50, endTime: 80 });
    expect(boundary.clamp(20, 0)).toBe(20);
  });
});

// The floor and ceiling applied to a position that simply *arrived*, rather
// than one Playdeck asked for (#381). `clamp` answers for a command; this
// answers for a report.
describe('correction', () => {
  // A port that has positioned its player and is not looping: the state in
  // which the floor is the only rule that applies. The loop cases below vary it.
  const arrived = { loop: false, positioned: true } as const;

  // The axes the two property sweeps below share.
  const startTimes = [0, 5, 20, 1e9];
  const endTimes = [undefined, 0.5, 30, 1e9];
  const states = [
    { loop: false, positioned: false },
    { loop: false, positioned: true },
    { loop: true, positioned: false },
    { loop: true, positioned: true }
  ];
  const durations: (number | null | undefined)[] = [
    null,
    undefined,
    0,
    10,
    30,
    120,
    Number.POSITIVE_INFINITY,
    Number.NaN
  ];
  const times = [
    -100,
    -1,
    0,
    0.001,
    4.999,
    5,
    19.999,
    20,
    29.999,
    30,
    30.001,
    119,
    1e9,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NaN
  ];
  const label = (state: { loop: boolean; positioned: boolean }): string =>
    `loop ${String(state.loop)} positioned ${String(state.positioned)}`;

  test.each<[string, number, number | undefined]>([
    ['below the start', 1, 5],
    ['at the start', 5, undefined],
    ['inside the window', 12, undefined],
    ['at the end', 20, undefined],
    ['past the end', 25, 20]
  ])('corrects a reported time %s', (_label, time, expected) => {
    const boundary = createTimeBoundary({ startTime: 5, endTime: 20 });
    expect(boundary.correction(30, time, arrived)).toBe(expected);
  });

  // The natural end of the media is the platform's own event to report, which
  // is the same gate `atEnd` applies. Nothing above the window is corrected
  // when the window has no end of its own.
  test.each<[string, number]>([
    ['at the duration', 30],
    ['past the duration', 31]
  ])('corrects nothing %s with no endTime', (_label, time) => {
    const boundary = createTimeBoundary({ startTime: 5 });
    expect(boundary.correction(30, time, arrived)).toBeUndefined();
  });

  test('corrects nothing at all with no window', () => {
    const boundary = createTimeBoundary({});
    expect(boundary.correction(30, 0, arrived)).toBeUndefined();
    expect(boundary.correction(30, 31, arrived)).toBeUndefined();
  });

  test('corrects to the duration-clamped start', () => {
    const boundary = createTimeBoundary({ startTime: 90 });
    expect(boundary.correction(60, 10, arrived)).toBe(60);
    expect(boundary.correction(60, 60, arrived)).toBeUndefined();
  });

  test('corrects to the duration-clamped end', () => {
    const boundary = createTimeBoundary({ startTime: 5, endTime: 90 });
    expect(boundary.correction(60, 70, arrived)).toBe(60);
  });

  // A report can arrive non-finite — YouTube's `getCurrentTime()` answers NaN
  // before its player is ready. Only NaN has no answer: nothing can be placed
  // against it, so the arithmetic would answer NaN itself, which is not a fixed
  // point. The infinities are ordered and answer like any other position
  // outside the window.
  test.each<[string, number, number | undefined]>([
    ['NaN, which nothing can be compared against', Number.NaN, undefined],
    ['Infinity, which is past the end', Number.POSITIVE_INFINITY, 20],
    ['-Infinity, which is below the start', Number.NEGATIVE_INFINITY, 5]
  ])('corrects a reported %s', (_label, time, expected) => {
    const boundary = createTimeBoundary({ startTime: 5, endTime: 20 });
    expect(boundary.correction(30, time, arrived)).toBe(expected);
  });

  // Above the window with no `endTime` the natural end is the platform's own
  // event, and Infinity is above every window.
  test('corrects nothing for a reported Infinity with no endTime', () => {
    const boundary = createTimeBoundary({ startTime: 5 });
    expect(boundary.correction(30, Number.POSITIVE_INFINITY, arrived)).toBeUndefined();
  });

  // The two must agree rather than double-correct: a command the clamp already
  // pulled into the window reports a position this leaves alone.
  test.each<[string, number]>([
    ['below the start', 0],
    ['past the end', 45]
  ])(
    'needs no second correction after clamping a command %s',
    (_label, time) => {
      const boundary = createTimeBoundary({ startTime: 5, endTime: 20 });
      expect(
        boundary.correction(30, boundary.clamp(30, time), arrived)
      ).toBeUndefined();
    }
  );

  // What breaks the feedback loop: every correction is a fixed point, so the
  // report the corrective seek produces asks for no correction of its own.
  test.each<[string, number | undefined, number | undefined, number]>([
    ['below a start', 5, undefined, 1],
    ['below a start inside a window', 5, 20, 1],
    ['past an end', 5, 20, 25],
    ['below a start past the duration', 90, undefined, 1],
    ['below a start past a duration-clamped end', 90, 120, 1]
  ])(
    'answers nothing for its own correction %s',
    (_label, startTime, endTime, time) => {
      const boundary = createTimeBoundary({ startTime, endTime });
      const corrected = boundary.correction(60, time, arrived);
      expect(corrected).toBeDefined();
      expect(boundary.correction(60, corrected!, arrived)).toBeUndefined();
    }
  );

  // The same property, swept rather than sampled, because the case that broke
  // it was one no named case reached. Over every combination of window, port
  // state, duration and reported time — the non-finite ones included —
  // wherever this answers a position, that position must be one it answers
  // nothing for.
  test('answers nothing for its own correction, over every window', () => {
    const unstable: string[] = [];
    for (const startTime of startTimes)
      for (const endTime of endTimes) {
        const boundary = createTimeBoundary({ startTime, endTime });
        for (const state of states)
          for (const duration of durations)
            for (const time of times) {
              const corrected = boundary.correction(duration, time, state);
              if (corrected === undefined) continue;
              const again = boundary.correction(duration, corrected, state);
              if (again !== undefined)
                unstable.push(
                  `[${startTime}, ${String(endTime)}] ${label(state)} duration ${String(duration)}: ${time} -> ${corrected} -> ${again}`
                );
            }
      }
    expect(unstable).toEqual([]);
  });

  // The loop wrap guard's positions are the wrap guard's, on every path (#381).
  //
  // The two rules overlap: both answer a playhead below the start boundary.
  // `atWrap` restarts *and* resumes such a position, the floor would only slide
  // it onto the start, and a playhead sitting exactly on the start is one
  // `atWrap` no longer recognises — so a floor that answered first would
  // silently retire the restart. The ports that ask the wrap guard first are
  // not what makes this safe, because two of them have a seek path that does
  // not: this is why the rule lives in `correction` rather than in the call
  // order. Swept over the same combinations as the fixed-point property.
  test('answers nothing wherever the wrap guard answers, over every window', () => {
    const overlaps: string[] = [];
    for (const startTime of startTimes)
      for (const endTime of endTimes) {
        const boundary = createTimeBoundary({ startTime, endTime });
        for (const state of states)
          for (const duration of durations)
            for (const time of times) {
              if (!boundary.atWrap(duration, time, state)) continue;
              const corrected = boundary.correction(duration, time, state);
              if (corrected !== undefined)
                overlaps.push(
                  `[${startTime}, ${String(endTime)}] ${label(state)} duration ${String(duration)}: ${time} -> ${corrected}`
                );
            }
      }
    expect(overlaps).toEqual([]);
    // The sweep would also pass if `atWrap` were never true over it.
    expect(
      createTimeBoundary({ startTime: 5 }).atWrap(30, 1, {
        loop: true,
        positioned: true
      })
    ).toBe(true);
  });

  // Nothing is corrected before the port has positioned its player: the reports
  // a load emits before the initial seek are a player still loading, and
  // correcting them would fight that seek. Gated here rather than in each port,
  // which is where all three gated it before.
  test.each<[string, number]>([
    ['below the start', 1],
    ['past the end', 25]
  ])('corrects nothing %s before the player is positioned', (_label, time) => {
    const boundary = createTimeBoundary({ startTime: 5, endTime: 20 });
    expect(
      boundary.correction(30, time, { loop: false, positioned: false })
    ).toBeUndefined();
    expect(
      boundary.correction(30, time, { loop: true, positioned: false })
    ).toBeUndefined();
  });

  // The same rule as the sweep above, spelled out on the case the ports meet:
  // a start boundary, a playhead behind it, and the only difference being who
  // owns the position.
  test('defers a below-start position to the wrap guard while looping', () => {
    const boundary = createTimeBoundary({ startTime: 10 });
    expect(boundary.correction(60, 1, arrived)).toBe(10);
    expect(
      boundary.correction(60, 1, { loop: true, positioned: true })
    ).toBeUndefined();
  });

  // The deferral is to the wrap guard alone, not to `loop`. Above the window a
  // looping player is at the end boundary, which `atWrap` says nothing about,
  // so the ceiling applies to it exactly as it does to a non-looping one.
  test('still corrects past the end while looping', () => {
    const boundary = createTimeBoundary({ startTime: 5, endTime: 20 });
    expect(
      boundary.correction(30, 25, { loop: true, positioned: true })
    ).toBe(20);
  });
});
