import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { Availability, PlayerCapabilities } from '@playdeck/core';
import ReasonLine, { firstRefusal } from '../src/components/ReasonLine';
import { capabilityWords, reasonWords } from '../src/bench-capabilities';

// Explicit rather than left to `@testing-library/react`'s own auto-cleanup:
// that hook installs itself off a global `afterEach`, and this suite does not
// run with `globals: true`.
afterEach(cleanup);

// Every capability available, as the starting point each case below refuses
// one thing from. Written as a function rather than a shared constant so a
// case cannot mutate the next one's input.
const allAvailable = (): PlayerCapabilities => {
  const available: Availability = { status: 'available' };
  return {
    seek: available,
    setVolume: available,
    setPlaybackRate: available,
    selectQuality: available,
    selectTextTrack: available,
    chapters: available,
    fullscreen: available,
    pictureInPicture: available,
    airPlay: available,
    customControls: available
  };
};

// The order the line's winner is decided by, read from the module that owns it
// rather than restated here: a test carrying its own copy of the order could
// not fail when that order changed.
const ORDER = Object.keys(capabilityWords) as (keyof PlayerCapabilities)[];

describe('firstRefusal', () => {
  it('reports nothing when the provider refused nothing', () => {
    expect(firstRefusal(allAvailable())).toBeNull();
  });

  it('reports nothing before a provider has attached', () => {
    expect(firstRefusal(null)).toBeNull();
  });

  // The rule this test exists for: `unknown` is not a refusal. `not-ready` and
  // `provider-check` both mean nobody has answered yet, and a line printed
  // from one would be the page inventing a fact on a reader's behalf -- and
  // would put back the resting placeholder the design removed.
  it('never reports an unknown, whichever reason it carries', () => {
    const capabilities: PlayerCapabilities = {
      ...allAvailable(),
      seek: { status: 'unknown', reason: 'not-ready' },
      airPlay: { status: 'unknown', reason: 'provider-check' }
    };

    expect(firstRefusal(capabilities)).toBeNull();
  });

  it('reports the capability that was refused, with its reason', () => {
    const capabilities: PlayerCapabilities = {
      ...allAvailable(),
      pictureInPicture: { status: 'unavailable', reason: 'provider-build' }
    };

    expect(firstRefusal(capabilities)).toEqual({
      capability: 'pictureInPicture',
      reason: 'provider-build'
    });
  });

  // One line means one line, and every pair is checked rather than one of
  // them: a sweep over `seek` and `airPlay` alone leaves the order of the
  // other forty-four pairs free to change with nothing failing.
  //
  // Each snapshot is built through `fromEntries`, with the *later* capability
  // written first. Spreading `allAvailable()` and reassigning two members
  // would leave the spread's own key order in place, and the case this is
  // aimed at -- an implementation that walked the snapshot rather than
  // `capabilityWords` -- is invisible unless the snapshot disagrees.
  it('reports the earlier of any two refusals in capabilityWords order', () => {
    for (const [index, earlier] of ORDER.entries()) {
      for (const later of ORDER.slice(index + 1)) {
        const capabilities = Object.fromEntries([
          [later, { status: 'unavailable', reason: 'browser' }],
          [earlier, { status: 'unavailable', reason: 'provider' }],
          ...Object.entries(allAvailable()).filter(
            ([key]) => key !== later && key !== earlier
          )
        ]) as PlayerCapabilities;

        expect(Object.keys(capabilities)[0]).toBe(later);
        expect(firstRefusal(capabilities)).toEqual({
          capability: earlier,
          reason: 'provider'
        });
      }
    }
  });
});

// The selection logic above is the half a unit test reaches naturally. These
// two are the requirement the component exists for, and they are what fails
// when the visible line stops being conditional: the design removed the
// resting placeholder, and an empty wrapper is that placeholder with the text
// taken out. What the component always mounts now is the hidden live region,
// which is checked here for being present and empty rather than for being
// absent -- an empty, visually-hidden span holds no layout space, so it does
// not put the placeholder back.
describe('ReasonLine', () => {
  it('renders no visible line when there is nothing to report', () => {
    const { container } = render(
      <ReasonLine provider="native" capabilities={allAvailable()} />
    );

    expect(container.querySelectorAll('[data-bench-reason]')).toHaveLength(0);
    const status = container.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    expect(status?.textContent).toBe('');
  });

  it('renders no visible line before a provider has attached, refusals or not', () => {
    const { container } = render(
      <ReasonLine
        provider={null}
        capabilities={{
          ...allAvailable(),
          seek: { status: 'unavailable', reason: 'provider' }
        }}
      />
    );

    expect(container.querySelectorAll('[data-bench-reason]')).toHaveLength(0);
    const status = container.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    expect(status?.textContent).toBe('');
  });

  it('renders one line, with the library words, when one was refused', () => {
    const { container } = render(
      <ReasonLine
        provider="hls"
        capabilities={{
          ...allAvailable(),
          selectTextTrack: { status: 'unavailable', reason: 'provider-build' }
        }}
      />
    );

    const lines = container.querySelectorAll('[data-bench-reason]');
    expect(lines).toHaveLength(1);

    const line = lines[0];
    // `data-live` is what the entry motion in `base.css` keys off. It arrives
    // with the words rather than after them, which is what makes the motion a
    // mark on a real state change.
    expect(line.hasAttribute('data-live')).toBe(true);
    expect(line.textContent).toContain('hls');
    expect(line.textContent).toContain(capabilityWords.selectTextTrack);
    expect(line.textContent).toContain(reasonWords['provider-build']);

    // The live region an assistive technology actually watches carries the
    // same words, not the visible line's own role.
    expect(line.hasAttribute('role')).toBe(false);
    const status = container.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    expect(status?.textContent).toContain(capabilityWords.selectTextTrack);
    expect(status?.textContent).toContain(reasonWords['provider-build']);
  });

  it('renders one line and not two when two were refused', () => {
    const { container } = render(
      <ReasonLine
        provider="native"
        capabilities={{
          ...allAvailable(),
          seek: { status: 'unavailable', reason: 'browser' },
          airPlay: { status: 'unavailable', reason: 'policy' }
        }}
      />
    );

    expect(container.querySelectorAll('[data-bench-reason]')).toHaveLength(1);
    expect(container.textContent).toContain(capabilityWords.seek);
    expect(container.textContent).not.toContain(capabilityWords.airPlay);
  });
});
