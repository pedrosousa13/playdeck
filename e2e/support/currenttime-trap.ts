import type { Page, TestInfo } from '@playwright/test';

// TEMPORARY measurement rig for #470, and nothing else. It is not a fix, it
// asserts nothing, and it is meant to be reverted once the question below is
// answered. Everything here exists to make CI decide ONE thing:
//
//   (A) the write never takes — `el.currentTime` reads something other than
//       the written value SYNCHRONOUSLY after the assignment, i.e. the engine
//       rejected or clamped it on the spot; or
//   (B) the write takes and something moves the playhead back to 0 afterwards
//       — in which case the stacks and the event log say WHO, library JS or
//       the engine unaided.
//
// #470 could not separate those two from the failure string `settledAt`
// prints, because that string is sampled up to 8s after the write and reports
// only the end state (`media 0` on a source whose `duration` and seekable
// extent are both 1). Both (A) and (B) produce exactly that. The synchronous
// reading the pointer test now takes, and the ordered log below, are what tell
// them apart — and the defect does not reproduce on the maintainer's machine
// (~70 targeted runs, zero occurrences), so CI is the only place to read them.

// A bound, because `timeupdate` and `durationchange` can flood: an early
// version of this rig produced ~530 samples per run, ~700 `durationchange`
// ticks among them, as the engine ground through the WebM in fractions of a
// millisecond at a time. That flood turned out to be the rig's own doing (see
// the note on `MediaEventSample`) and a healthy run now logs ~20 events — but
// a bound still belongs here, because CI's WebKit is slower than the machine
// that was measured and nobody has measured the flood there.
//
// It drops out of the MIDDLE rather than off the front: the first
// HEAD_ENTRIES are permanent, everything after them rolls. The tail is where
// the write is, the head is the load progression — `loadstart`,
// `loadedmetadata`, `canplay`, `play`, which a plain "last N" bound lost
// wholesale — and the ticks in between are the ones nobody needs one by one.
const ENTRY_LIMIT = 400;
const HEAD_ENTRIES = 60;

type CurrentTimeWrite = {
  readonly t: number;
  readonly value: number;
  // Read through the ORIGINAL getter, immediately either side of the original
  // setter. `after` is the whole point of the rig: it is (A) or (B) in one
  // number, taken before any task, microtask or event can have run.
  readonly before: number;
  readonly after: number;
  readonly stack: string;
};

type MediaEventSample = {
  readonly t: number;
  readonly type: string;
  readonly currentTime: number;
  readonly paused: boolean;
  readonly ended: boolean;
  readonly readyState: number;
  readonly duration: number;
  readonly errorCode: number | null;
};

// There is deliberately NO `seekableEnd` on the sample above, even though the
// seekable extent is the value #470 turns on. Reading `el.seekable` from
// inside a media event listener changes what this engine does, and by enough
// to invent a second defect on top of the one being measured.
//
// Measured on local WebKit, `--repeat-each=8 --retries=0`, on the keyboard
// test — which writes `currentTime = 0` without waiting on `seekableThrough`
// first, and so is the sensitive one:
//
//   no rig at all                            12 of 12 passed
//   setter trap only, no listeners            8 of 8  passed
//   listeners, handler reads NO properties    8 of 8  passed
//   listeners, every read EXCEPT el.seekable  8 of 8  passed
//   listeners, el.seekable included          16 of 28 FAILED
//
// Every failure in that last row is the #407 partly-parsed shape — a
// fractional `Received` (0.065 to 0.605), `readyState` back at 2, `stalled`,
// and the duration frozen where the parse had reached — not #470's
// `Received: 0` on a fully parsed source. So this is the instrument freezing
// the load, not the instrument catching anything.
//
// Dropping the read is affordable because nothing else is lost: `duration`
// tracks the extent tick for tick on this fixture (measured on a healthy run,
// each `durationchange` reports the previous extent as the new duration), the
// pointer test's `seekableThrough` polls the real extent before the write, and
// the synchronous capture at the write reads it there — all three from a
// `page.evaluate`, outside event dispatch, which is where the existing tests
// have always read it from without disturbing anything.

type CurrentTimeRig = {
  // Set by the init script itself, once the accessor swap has actually
  // happened. If a dump reports `installed: false` the instrument was never
  // in place and every empty array below means nothing at all.
  installed: boolean;
  readonly writes: CurrentTimeWrite[];
  readonly events: MediaEventSample[];
  droppedWrites: number;
  droppedEvents: number;
};

declare global {
  interface Window {
    __pd470?: CurrentTimeRig;
  }
}

// Installed through `addInitScript` rather than an `evaluate` after `goto`,
// because the story's own JS mounts the player and can write a position before
// the first `await` in the test returns. A trap that arrives after the page
// has run has already missed the writes it exists to record.
export const installCurrentTimeTrap = (page: Page) =>
  page.addInitScript(
    (bound: { head: number; limit: number }) => {
      const rig: CurrentTimeRig = {
        installed: false,
        writes: [],
        events: [],
        droppedWrites: 0,
        droppedEvents: 0
      };
      window.__pd470 = rig;

      const push = <Entry>(log: Entry[], entry: Entry, onDrop: () => void) => {
        log.push(entry);
        if (log.length > bound.limit) {
          // Out of the middle, not off the front: `bound.head` entries are
          // permanent and the rest rolls.
          log.splice(bound.head, 1);
          onDrop();
        }
      };

      const descriptor = Object.getOwnPropertyDescriptor(
        HTMLMediaElement.prototype,
        'currentTime'
      );
      // Delegating to the original accessors, not reimplementing them: a
      // wrapper that stored the value in a field of its own would answer the
      // test's reads from that field and hide the very disagreement being
      // measured. Both halves are called with the right `this`, so the getter
      // stays a live read of the engine's playhead.
      const read = descriptor?.get;
      const write = descriptor?.set;
      if (read !== undefined && write !== undefined) {
        Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', {
          configurable: true,
          enumerable: descriptor?.enumerable ?? true,
          get(this: HTMLMediaElement) {
            return read.call(this);
          },
          set(this: HTMLMediaElement, value: number) {
            const before = read.call(this) as number;
            write.call(this, value);
            const after = read.call(this) as number;
            push(
              rig.writes,
              {
                t: performance.now(),
                value,
                before,
                after,
                // Captured here rather than derived later: this is the only
                // record of WHO wrote. On a run that ends with the playhead at
                // 0 after a write of 1, a second write carrying a library frame
                // is (B) with a culprit named, and no second write at all is
                // (B) with the engine acting unaided.
                stack: new Error().stack ?? '<no stack>'
              },
              () => {
                rig.droppedWrites += 1;
              }
            );
          }
        });
        rig.installed = true;
      }

      // Every event the native adapter or the engine could plausibly move the
      // playhead from, plus the load-progression events that say how far the
      // source had parsed when it happened. `progress` and `suspend` are left
      // out deliberately: they carry no position and would crowd the bound.
      const types = [
        'loadstart',
        'loadedmetadata',
        'loadeddata',
        'canplay',
        'play',
        'playing',
        'pause',
        'ended',
        'seeking',
        'seeked',
        'timeupdate',
        'durationchange',
        'emptied',
        'abort',
        'stalled',
        'waiting',
        'ratechange',
        'error'
      ];

      // Media events do NOT bubble, so a listener on `document` sees them only
      // in the CAPTURE phase — which is enough, because capture runs down the
      // ancestor chain to the target whatever `bubbles` says. That buys one
      // listener set installed before any media element exists, rather than
      // chasing elements as the player mounts and swaps sources. If a dump ever
      // shows writes but no events, this is the assumption that broke, and the
      // fallback is to attach the same listeners to the element itself from
      // inside the setter trap the first time it fires.
      for (const type of types) {
        document.addEventListener(
          type,
          (event: Event) => {
            const el = event.target;
            // `error` and `abort` fire on <img> and <script> too; the rig is
            // only interested in media.
            if (!(el instanceof HTMLMediaElement)) return;
            // No `el.seekable` here, and that omission is measured rather
            // than a preference — see the note above the type.
            push(
              rig.events,
              {
                t: performance.now(),
                type,
                currentTime: el.currentTime,
                paused: el.paused,
                ended: el.ended,
                readyState: el.readyState,
                duration: el.duration,
                errorCode: el.error === null ? null : el.error.code
              },
              () => {
                rig.droppedEvents += 1;
              }
            );
          },
          true
        );
      }
    },
    { head: HEAD_ENTRIES, limit: ENTRY_LIMIT }
  );

// `NaN` and `Infinity` survive Playwright's own evaluate serialization, but
// `JSON.stringify` turns both into `null` — which would quietly erase the
// distinction #470 rests on, an unparsed `duration` versus a parsed one. So
// every number in the dump is formatted here instead of stringified.
const num = (value: number) =>
  Number.isFinite(value) ? value.toFixed(6) : `${value}`;

// A stack is the widest field in the dump and most of it is Storybook's
// bundle. Six frames is enough to name the writer and shallow enough to keep
// one write to a few lines.
const STACK_FRAMES = 6;

const formatWrite = (write: CurrentTimeWrite, index: number) =>
  [
    `  write #${index + 1}  t=${write.t.toFixed(1)}  set ${num(write.value)}`,
    `    before=${num(write.before)}  after=${num(write.after)}  ` +
      `${write.after === write.value ? 'TOOK' : 'DID NOT TAKE'}`,
    ...write.stack
      .split('\n')
      .slice(0, STACK_FRAMES)
      .map((frame) => `    | ${frame.trim()}`)
  ].join('\n');

const formatEvent = (event: MediaEventSample) =>
  `  ${event.t.toFixed(1).padStart(9)}  ${event.type.padEnd(14)}` +
  ` ct=${num(event.currentTime)} paused=${event.paused ? 'y' : 'n'}` +
  ` ended=${event.ended ? 'y' : 'n'} rs=${event.readyState}` +
  ` dur=${num(event.duration)}` +
  (event.errorCode === null ? '' : ` error=${event.errorCode}`);

// The bound drops out of the MIDDLE, so a log that lost entries is not
// continuous and must not read as if it were. This marks the seam.
const withGap = (lines: string[], dropped: number) =>
  dropped === 0
    ? lines
    : [
        ...lines.slice(0, HEAD_ENTRIES),
        `  ... ${dropped} entries dropped here to stay inside the ${ENTRY_LIMIT} bound ...`,
        ...lines.slice(HEAD_ENTRIES)
      ];

const formatRig = (rig: CurrentTimeRig, title: string, status: string) =>
  [
    `===== #470 currentTime rig: ${title} [${status}] =====`,
    `installed=${rig.installed}` +
      ` writes=${rig.writes.length} (+${rig.droppedWrites} dropped)` +
      ` events=${rig.events.length} (+${rig.droppedEvents} dropped)`,
    '--- writes (oldest first) ---',
    ...(rig.writes.length === 0
      ? ['  <none recorded>']
      : withGap(rig.writes.map(formatWrite), rig.droppedWrites)),
    '--- events (oldest first) ---',
    ...(rig.events.length === 0
      ? ['  <none recorded>']
      : withGap(rig.events.map(formatEvent), rig.droppedEvents)),
    `===== end #470 rig: ${title} =====`
  ].join('\n');

// Dumped on every instrumented run, passing or failing, rather than only on
// failure. #470 is a ~50% flake whose mechanism is unknown, so a healthy run's
// log is not noise — it is the control the failing one has to be read against,
// and under `--repeat-each` both land in the same job. The dump goes to stdout
// AND to an attachment: stdout is what a human reads in a plain CI log, the
// attachment is what survives into the HTML report.
export const dumpCurrentTimeTrap = async (page: Page, testInfo: TestInfo) => {
  // The rig is only installed by the two tests #470 names, so its absence is
  // how this hook stays scoped to them without repeating their titles here. A
  // page that crashed or was already closed lands in the catch, because a
  // diagnostic must never become a second failure.
  let rig: CurrentTimeRig | undefined;
  try {
    rig = await page.evaluate(() => window.__pd470);
  } catch (error) {
    console.log(`[#470] rig unreadable: ${String(error)}`);
    return;
  }
  if (rig === undefined) return;

  const status = `${testInfo.status ?? 'unknown'}, expected ${testInfo.expectedStatus}`;
  const dump = formatRig(rig, testInfo.title, status);
  console.log(dump);
  await testInfo.attach('pd470-currenttime-rig', {
    body: dump,
    contentType: 'text/plain'
  });
};
