/*
 * One line of what the mounted provider refused, and nothing when it refused
 * nothing.
 *
 *   youtube · no picture in picture
 *   └ the third-party runtime it was given leaves it out
 *
 * This is the whole of the capability argument on `/`. A five-row panel and a
 * ten-by-five provider grid were both designed and both cut, so a later reader
 * finding this line small should read the spec before growing it back: a list
 * here is the table this page deleted.
 *
 * Three rules, and each is easy to break by being helpful.
 *
 * **The visible line renders nothing when there is nothing to report.** No
 * wrapper, no empty element, no reserved height, no "nothing asked yet". A
 * layout that holds space for this line is the resting placeholder the
 * design removed on purpose, and the only way to make that unwritable is for
 * the visible `<p>` to not exist at rest. What the component returns instead
 * is never `null` any more, because a screen reader needs a live region
 * present and empty before it has anything to say -- one inserted already
 * populated is not reliably announced. So a second, always-mounted,
 * visually-hidden span carries `role="status"` and the same words, and it is
 * `.u-visually-hidden` rather than absent, which is how it stays unwritable
 * to layout while staying present to the DOM.
 *
 * **It reports the provider that is mounted right now**, which is the one the
 * reader just pressed, and only capabilities the controller answered
 * `unavailable` for. An `unknown` is not a refusal: `not-ready` and
 * `provider-check` mean nobody has answered yet, and a line that printed one
 * would be this page inventing a fact on a reader's behalf.
 *
 * **Its words are the library's.** `capabilityWords` and `reasonWords` in
 * `bench-capabilities.ts` are the only English here beyond `no`, the `·` and
 * the `└` -- and it never reads `src/provider-asymmetry.mjs`, which is what a
 * document says a provider can do rather than what this provider just said.
 *
 * The entry motion lives in `base.css`, under `[data-stance='argument']` and
 * keyed off `[data-bench-reason]` and `data-live` -- see the block there for
 * why the rule is not written in a component's scoped style, and why the
 * stance is what keeps it off every other page rather than a comment asking.
 * What this file owes it is the two attributes.
 */
import type { PlayerCapabilities, PlayerProvider } from '@playdeck/core';
import {
  capabilityWords,
  reasonWords,
  type UnavailableReason
} from '@/bench-capabilities';

export type Refusal = {
  readonly capability: keyof PlayerCapabilities;
  readonly reason: UnavailableReason;
};

/**
 * The one refusal this line prints, or `null` when the provider refused
 * nothing it was asked.
 *
 * `capabilityWords`'s own key order decides which one wins, so the order a
 * reader sees is the order that file is written in rather than whatever order
 * a snapshot's keys happen to arrive in. Exported for its own unit test:
 * which capability wins when several are refused, and that an `unknown` never
 * wins, are the two things about this component worth pinning.
 */
export const firstRefusal = (
  capabilities: PlayerCapabilities | null
): Refusal | null => {
  if (capabilities === null) return null;
  const keys = Object.keys(capabilityWords) as (keyof PlayerCapabilities)[];
  for (const capability of keys) {
    const availability = capabilities[capability];
    if (availability.status === 'unavailable') {
      return { capability, reason: availability.reason };
    }
  }
  return null;
};

export type ReasonLineProps = {
  /** The provider mounted right now, or `null` before one has attached. */
  readonly provider: PlayerProvider | null;
  /** That provider's capabilities, as the controller currently answers them. */
  readonly capabilities: PlayerCapabilities | null;
};

export default function ReasonLine({
  provider,
  capabilities
}: ReasonLineProps) {
  const refusal = provider === null ? null : firstRefusal(capabilities);

  // The live region a screen reader announces, and the reason it is a sibling
  // rather than a role on the visible line below. A `role="status"` only
  // starts being watched once it exists in the DOM: an element inserted
  // already carrying its text is not reliably announced, because there was no
  // moment at which the region was present and empty for the assistive
  // technology to pick up first. So this span is unconditional -- it is
  // always mounted, `.u-visually-hidden` so it takes no layout space, and
  // empty until there is something to say. That satisfies the same rule the
  // visible line answers to: nothing here holds space for it, because an
  // empty visually-hidden span occupies none.
  const words =
    refusal === null
      ? ''
      : `${provider} · no ${capabilityWords[refusal.capability]}. ${reasonWords[refusal.reason]}`;

  return (
    <>
      <span role="status" className="u-visually-hidden">
        {words}
      </span>
      {refusal !== null && (
        // `data-live` is written without a condition because the element
        // itself is the condition: it exists only once a provider has
        // attached and answered no. The attribute is what the animation in
        // `base.css` keys off, and it arrives in the same React commit as the
        // words it marks, so the motion can neither run early nor dress a
        // state change that did not happen. It carries no role: the live
        // region above is what gets announced, so this line does not need to
        // repeat that job.
        <p
          data-bench-reason=""
          data-live=""
          className="grid gap-[var(--space-1)] font-mono text-[length:var(--text-fn)] tracking-[var(--tracking-fn)] text-[var(--color-unavailable)]"
        >
          <span>
            {provider} · no {capabilityWords[refusal.capability]}
          </span>
          <span className="text-[var(--color-ink-subtle)]">
            └ {reasonWords[refusal.reason]}
          </span>
        </p>
      )}
    </>
  );
}
