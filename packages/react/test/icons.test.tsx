// @vitest-environment happy-dom

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
import { AirPlayIcon, PlayIcon, CheckIcon, SettingsIcon } from '../src/icons';
import * as Player from '../src/index';

afterEach(cleanup);

describe('icons', () => {
  test('render inline svg with currentColor and are decorative by default', () => {
    const { container } = render(<PlayIcon />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('fill')).toBe('currentColor');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 24 24');
  });

  test('spread props override defaults (e.g. explicit labelling)', () => {
    const { container } = render(
      <CheckIcon aria-hidden={false} role="img" aria-label="Selected" />
    );
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('aria-hidden')).toBeNull();
    expect(svg?.getAttribute('aria-label')).toBe('Selected');
  });

  test('are re-exported from the package entry', () => {
    expect(Player.SettingsIcon).toBe(SettingsIcon);
    expect(Player.PlayIcon).toBe(PlayIcon);
    expect(Player.AirPlayIcon).toBe(AirPlayIcon);
  });

  test('AirPlayIcon draws a glyph', () => {
    // Asserting fill/aria-hidden/viewBox here would only re-test the shared
    // `Icon` wrapper: any component that renders `<Icon>` passes that whether
    // or not it draws anything. Nothing else in the repo renders this icon --
    // AirPlayButton falls back to a text label -- so this is the only thing
    // standing between a blank glyph and a release.
    const { container } = render(<AirPlayIcon />);
    const paths = [...container.querySelectorAll('svg > path')];
    // Both halves of the glyph: the screen outline and the triangle. Pinning
    // the count catches one being deleted.
    expect(paths.length).toBe(2);
    for (const path of paths) {
      // Measuring the extent the path covers, not its string length: a long
      // `d` of repeated `M0 0z` is 15 characters and draws nothing at all.
      const numbers = (path.getAttribute('d') ?? '')
        .match(/-?\d+(\.\d+)?/g)
        ?.map(Number);
      expect(numbers?.length).toBeGreaterThan(3);
      const spread =
        Math.max(...(numbers ?? [0])) - Math.min(...(numbers ?? [0]));
      expect(spread).toBeGreaterThan(5);
    }
  });
});
