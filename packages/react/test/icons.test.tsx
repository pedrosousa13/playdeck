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
    expect(Player.AirPlayIcon).toBeDefined();
    expect(Player.AirPlayIcon).toBe(AirPlayIcon);
  });

  test('AirPlayIcon follows the shared icon shape', () => {
    const { container } = render(<AirPlayIcon />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('fill')).toBe('currentColor');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 24 24');
  });
});
