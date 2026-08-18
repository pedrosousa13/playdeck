import { createInitialPlayerState, type Availability } from '@playdeck/core';
import { describe, expect, it } from 'vitest';
import { available, notReady, ready, unavailable } from './support';

const isValidAvailability = (a: Availability): boolean => {
  switch (a.status) {
    case 'available':
      return true;
    case 'unknown':
      return a.reason === 'not-ready' || a.reason === 'provider-check';
    case 'unavailable':
      return [
        'browser',
        'provider',
        'provider-plan',
        'source',
        'policy'
      ].includes(a.reason);
    default:
      return false;
  }
};

describe('story support derives from the real core contract', () => {
  it('ready() capability keys match the core contract exactly', () => {
    const staged = ready().player.state?.capabilities ?? {};
    const core = createInitialPlayerState().capabilities;
    expect(Object.keys(staged).sort()).toEqual(Object.keys(core).sort());
  });

  it('unspecified capabilities default to the core not-ready value', () => {
    const staged = ready().player.state?.capabilities;
    const core = createInitialPlayerState().capabilities;
    expect(staged?.seek).toEqual(core.seek);
  });

  it('capability overrides win over the derived base', () => {
    const staged = ready({ seek: available }).player.state?.capabilities;
    expect(staged?.seek).toEqual(available);
  });

  it('exported Availability samples are all valid core values', () => {
    for (const a of [available, notReady, unavailable]) {
      expect(isValidAvailability(a)).toBe(true);
    }
  });
});
