import { describe, expect, it } from 'vitest';
import { BENCH_CONTROLS, type BenchControlName } from '../src/bench-controls';

describe('BENCH_CONTROLS', () => {
  it('lists SeekSlider first, then row two in the contract order', () => {
    expect(BENCH_CONTROLS).toEqual([
      'seekSlider',
      'playButton',
      'muteButton',
      'volumeSlider',
      'timeCurrent',
      'timeDuration',
      'captionsButton',
      'settingsMenu',
      'pipButton',
      'fullscreenButton'
    ]);
  });

  it('fails to typecheck a Record missing one control name', () => {
    // A total `Record<BenchControlName, T>` forces every name in the tuple to
    // have an entry. Omitting one, `pipButton` here, must not compile: if it
    // stops erroring, this directive itself fails under `tsc -b` ("Unused
    // '@ts-expect-error' directive"), which is what makes this a real proof
    // rather than a comment nobody re-reads.
    // @ts-expect-error a Record<BenchControlName, T> missing 'pipButton' must not typecheck.
    const incomplete: Record<BenchControlName, true> = {
      seekSlider: true,
      playButton: true,
      muteButton: true,
      volumeSlider: true,
      timeCurrent: true,
      timeDuration: true,
      captionsButton: true,
      settingsMenu: true,
      fullscreenButton: true
    };
    expect(Object.keys(incomplete)).toHaveLength(9);
  });
});
