import type { PlayerEventFor, ProviderEventFor } from '@playdeck/core';

declare const playerEvent: PlayerEventFor<'play'>;
declare const providerEvent: ProviderEventFor<'play'>;

const playerOriginalEvent: unknown = playerEvent.originalEvent;
const providerOriginalEvent: unknown = providerEvent.originalEvent;

export { playerOriginalEvent, providerOriginalEvent };
