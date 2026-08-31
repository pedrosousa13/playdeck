/*
 * The words behind the one capability line the bench prints, shown only when
 * the mounted provider has refused something:
 *
 *   youtube · no picture in picture
 *   └ the provider cannot do it
 *
 * No table, no grid, no list survives this page's capability argument — a
 * five-row browser panel and a ten-by-five provider grid were both designed
 * and both cut. This is what is left: a noun phrase for the capability that
 * was refused, and a clause for why.
 */
import type { Availability, PlayerCapabilities } from '@playdeck/core';

// `Availability`'s `unavailable` branch carries the only reasons this line
// ever prints, so the type is pulled out of it with `Extract` rather than
// restated by hand -- a reason added to or removed from that branch changes
// this type too, without a second place to remember to edit.
export type UnavailableReason = Extract<
  Availability,
  { readonly status: 'unavailable' }
>['reason'];

// Keyed by capability, the way `REFUSED_URL_NOTICES` in
// packages/core/src/safety.ts is keyed by surface: a `Record<keyof
// PlayerCapabilities, ...>` object literal is exhaustive under TypeScript's
// excess-property checking, so `PlayerCapabilities` gaining or losing a
// member is a compile error here rather than a line that quietly never
// prints or prints nothing for the new one.
export const capabilityWords: Record<keyof PlayerCapabilities, string> = {
  seek: 'seeking',
  setVolume: 'volume control',
  setPlaybackRate: 'playback speed control',
  selectQuality: 'quality selection',
  selectTextTrack: 'text track selection',
  chapters: 'chapter reporting',
  fullscreen: 'fullscreen',
  pictureInPicture: 'picture in picture',
  airPlay: 'AirPlay',
  customControls: 'custom controls'
};

// Only the six `unavailable` reasons get words here. `not-ready` and
// `provider-check` are `unknown`, not a refusal -- this line appears only
// once a provider has answered and the answer was no, so an unknown must
// never reach it. Adding either of those two members to this object would
// put back the resting placeholder the design deliberately removed.
export const reasonWords: Record<UnavailableReason, string> = {
  browser: 'the browser cannot do it',
  provider: 'the provider cannot do it',
  // Distinct from `provider`, which says the provider cannot do this at all,
  // and from `provider-build` below, which is a fact about the runtime
  // bundled with it rather than about the account behind it.
  'provider-plan': "the provider's plan does not include it",
  // The provider is present and able; the third-party runtime it was handed
  // is the one that leaves this out. Kept apart from `provider` (which would
  // be false here) and from `source` (also false: the media may well offer
  // this, the build just cannot show it). Worded with the runtime as the
  // subject, not the provider, since the provider is not what is at fault.
  'provider-build': 'the third-party runtime it was given leaves it out',
  source: 'the source does not offer it',
  // Not always the browser: this reason also covers a consumer-set attribute
  // (disablePictureInPicture, x-webkit-airplay="deny") and, for YouTube's
  // custom-controls refusal, the provider's own terms. Kept as an
  // abstraction rather than naming one actor, because no single one is
  // always the one behind it.
  policy: 'a policy refuses it'
};
