import type { VimeoSource } from '@playdeck/core';

// The watch url both oEmbed-based probes ask about: chromeless-availability's
// account-tier check and poster-availability's thumbnail lookup read the same
// record for the same source (#556).
export const vimeoWatchUrl = (
  source: Pick<VimeoSource, 'videoId' | 'hash'>
): string =>
  `https://vimeo.com/${source.videoId}${source.hash ? `/${source.hash}` : ''}`;

// Measured against the live oEmbed API, which answers well inside this,
// whichever of the two probes below is waiting on it. Independently declared
// beside `CHROMELESS_PROBE_TIMEOUT_MS` and `POSTER_PROBE_TIMEOUT_MS`, which
// this is the figure both of those already used before either probe could
// share a request with the other -- the three must stay equal.
const OEMBED_REQUEST_TIMEOUT_MS = 4000;

// What the raw request settled on, ahead of either probe's own reading of it:
// whether Vimeo answered at all and, if it did, the parsed body -- `undefined`
// for a refused response or one whose body was not a JSON object. A request
// that never answered also says whether that is because it was deliberately
// withdrawn (a `cancel()`, or a fresh request superseding it) rather than
// because the deadline gave up on it or it failed outright: only
// `chromeless-availability.ts` reads that half, to tell a probe that
// completed without an answer worth a notice (#235) apart from one that was
// simply no longer wanted. `poster-availability.ts` reports the same
// `unresolved` either way, so it never needs to ask.
export type VimeoOembedOutcome =
  | {
      readonly responded: true;
      readonly record: Record<string, unknown> | undefined;
    }
  | { readonly responded: false; readonly withdrawn: boolean };

const fetchOembedRecord = async (
  source: Pick<VimeoSource, 'videoId' | 'hash'>,
  signal: AbortSignal
): Promise<{
  readonly responded: boolean;
  readonly record?: Record<string, unknown>;
}> => {
  // Set the moment a response exists, whatever it turns out to say. A refused
  // status and a body that will not parse are both Vimeo answering, so the
  // `catch` below can tell a read that failed after the answer arrived from a
  // request that never produced one at all (#235) -- what a cancel
  // interrupting the body read reports, since `responded` is already `true`
  // by then.
  let responded = false;
  try {
    const response = await fetch(
      `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(
        vimeoWatchUrl(source)
      )}`,
      // The same policy both embed iframes declare, set here for the same
      // reason: an init-level policy overrides the document's the way a
      // frame's attribute does, and without one this request travels under
      // whatever the consumer's page declares. On a page declaring something
      // wider than the modern browser default — `unsafe-url`, say — that hands
      // vimeo.com this page's path and query in the `Referer` header (#334).
      // Not `no-referrer` or `origin`: the origin is what Vimeo's
      // domain-restriction check reads (see "What referrer each embed sends"
      // in docs/third-party-requests.md), and this policy keeps it while
      // dropping the path and query that are the disclosure.
      { signal, referrerPolicy: 'strict-origin-when-cross-origin' }
    );
    responded = true;
    if (!response.ok) return { responded: true };
    const data: unknown = await response.json();
    return {
      responded: true,
      record:
        typeof data === 'object' && data !== null
          ? (data as Record<string, unknown>)
          : undefined
    };
  } catch {
    // A request that never produced an answer -- rejected, or aborted by a
    // withdrawal or the deadline below -- reports `responded: false`; a read
    // that failed after the response already arrived reports the opposite.
    return { responded };
  }
};

// The two capabilities that can ask this source's oEmbed record about itself.
// A union rather than a boolean so a third probe added later has somewhere to
// join without renaming this one.
export type VimeoOembedFacet = 'chromeless' | 'poster';

export type VimeoOembedRequest = {
  // Starts, or joins, the shared GET: a facet that has not yet asked about
  // the request currently in flight joins it and gets the same answer, the
  // way it would have got its own. A facet asking again -- its own retry, not
  // the other facet's first ask of this same request -- withdraws whatever is
  // in flight and starts over, the same as each probe's own repeated
  // `probe()` always has.
  readonly request: (facet: VimeoOembedFacet) => Promise<VimeoOembedOutcome>;
  // Withdraws the request in flight, the way each probe's own `cancel()`
  // always has -- reported as withdrawn, not as a failure to answer.
  readonly cancel: () => void;
};

// One request in flight at a time, shared by whichever of the chromeless and
// poster probes ask about it: Vimeo's oEmbed record answers both `account_type`
// and `thumbnail_url` from the same GET, so a consumer opting into both
// `customControls` and `resolvePoster` must pay for one, not two (#556).
// `createVimeoChromelessAvailability` and `createVimeoPosterAvailability`
// each build a private instance of this when none is handed to them, so
// either standing alone behaves exactly as it did before this request existed
// to share; `createVimeoProvider` builds one instance and hands it to both.
export const createVimeoOembedRequest = (
  source: Pick<VimeoSource, 'videoId' | 'hash'>
): VimeoOembedRequest => {
  type InFlight = {
    readonly askedBy: Set<VimeoOembedFacet>;
    readonly promise: Promise<VimeoOembedOutcome>;
    readonly withdraw: () => void;
  };

  let inFlight: InFlight | undefined;

  const start = (): InFlight => {
    const controller = new AbortController();
    let withdrawn = false;
    const raw = fetchOembedRecord(source, controller.signal);
    // Settles on whichever comes first: the request, or the abort that either
    // the deadline or a withdrawal raises. Both of those abort the same
    // signal the request was given, but a request built to ignore an aborted
    // signal (a test double, or a fetch implementation with no support for
    // it) would otherwise never settle on its own -- so this resolves from
    // the abort directly rather than waiting on the request to notice it.
    const promise = new Promise<VimeoOembedOutcome>((resolve) => {
      const settle = (value: VimeoOembedOutcome): void => {
        clearTimeout(timer);
        controller.signal.removeEventListener('abort', onAbort);
        resolve(value);
      };
      const onAbort = (): void => settle({ responded: false, withdrawn });
      const timer = setTimeout(
        () => controller.abort(),
        OEMBED_REQUEST_TIMEOUT_MS
      );
      controller.signal.addEventListener('abort', onAbort);
      raw.then((result) =>
        settle(
          result.responded
            ? { responded: true, record: result.record }
            : { responded: false, withdrawn }
        )
      );
    });
    const entry: InFlight = {
      askedBy: new Set(),
      promise: promise.finally(() => {
        if (inFlight === entry) inFlight = undefined;
      }),
      withdraw: () => {
        withdrawn = true;
        controller.abort();
      }
    };
    inFlight = entry;
    return entry;
  };

  return {
    request: (facet) => {
      if (inFlight && !inFlight.askedBy.has(facet)) {
        inFlight.askedBy.add(facet);
        return inFlight.promise;
      }
      inFlight?.withdraw();
      const entry = start();
      entry.askedBy.add(facet);
      return entry.promise;
    },
    cancel: () => inFlight?.withdraw()
  };
};
