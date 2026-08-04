import { describe, expect, it } from 'vitest';
import {
  aspectRatioProperty,
  backpackVideoCss,
  backpackVideoStyles,
  breakpointMinWidths,
  naturalAspectRatio,
  resolveAspectRatios,
  resolveVariantClass,
  type BackpackAspectRatio
} from './backpack-video-styles';

/**
 * The value `'natural'` resolves to. Restated here rather than imported so a
 * change to the published-property rule has to be made in two places on
 * purpose — this is the one mapping the wrapper takes from ADR-0002 rather
 * than from Backpack.
 */
const naturalValue = 'var(--reely-media-aspect-ratio, 16 / 9)';

describe('resolveAspectRatios', () => {
  it('resolves Backpack’s own default to the published-ratio rule at every breakpoint', () => {
    expect(resolveAspectRatios(undefined)).toEqual({
      '--ef-video-aspect-s': naturalValue,
      '--ef-video-aspect-m': naturalValue,
      '--ef-video-aspect-l': naturalValue,
      '--ef-video-aspect-xl': naturalValue,
      '--ef-video-aspect-xxl': naturalValue
    });
  });

  it('applies a scalar value at every breakpoint', () => {
    expect(resolveAspectRatios('9/16')).toEqual({
      '--ef-video-aspect-s': '9 / 16',
      '--ef-video-aspect-m': '9 / 16',
      '--ef-video-aspect-l': '9 / 16',
      '--ef-video-aspect-xl': '9 / 16',
      '--ef-video-aspect-xxl': '9 / 16'
    });
  });

  it('carries a breakpoint value forward to the wider breakpoints it does not name', () => {
    expect(resolveAspectRatios({ s: '9/16', m: '16/9' })).toEqual({
      '--ef-video-aspect-s': '9 / 16',
      '--ef-video-aspect-m': '16 / 9',
      '--ef-video-aspect-l': '16 / 9',
      '--ef-video-aspect-xl': '16 / 9',
      '--ef-video-aspect-xxl': '16 / 9'
    });
  });

  it('leaves the breakpoints below the narrowest named one at the default', () => {
    expect(resolveAspectRatios({ l: '1/1' })).toEqual({
      '--ef-video-aspect-s': naturalValue,
      '--ef-video-aspect-m': naturalValue,
      '--ef-video-aspect-l': '1 / 1',
      '--ef-video-aspect-xl': '1 / 1',
      '--ef-video-aspect-xxl': '1 / 1'
    });
  });

  it('treats an empty map as the default', () => {
    expect(resolveAspectRatios({})).toEqual(resolveAspectRatios(undefined));
  });

  // Every member of Backpack's `AspectRatios` union
  // (`src/additional-types.ts:193-211`), so a value added to the type without
  // a mapping cannot pass unnoticed.
  const expected: Record<BackpackAspectRatio, string> = {
    unset: 'unset',
    auto: 'auto',
    natural: naturalValue,
    '1/1': '1 / 1',
    '2/1': '2 / 1',
    '3/2': '3 / 2',
    '16/9': '16 / 9',
    '18/9': '18 / 9',
    '2/3': '2 / 3',
    '4/3': '4 / 3',
    '3/4': '3 / 4',
    '9/16': '9 / 16',
    '9/18': '9 / 18',
    '21/9': '21 / 9',
    '5/4': '5 / 4',
    '4/5': '4 / 5',
    '3/1': '3 / 1',
    '1/2': '1 / 2'
  };

  it.each(Object.entries(expected))('maps %s to %s', (ratio, css) => {
    expect(resolveAspectRatios(ratio as BackpackAspectRatio)).toEqual(
      expect.objectContaining({ '--ef-video-aspect-s': css })
    );
  });
});

describe('backpackVideoCss', () => {
  const css = backpackVideoCss('480px');

  /**
   * The declarations of one rule, so that asserting a property is *in that rule*
   * cannot be satisfied by the same property in another one. Needed because this
   * stylesheet is one string: a `toContain` against the whole of it says only that
   * a declaration exists somewhere.
   */
  const ruleBody = (selector: string): string => {
    const from = css.indexOf(selector);
    expect(from, `no rule for ${selector}`).toBeGreaterThan(-1);
    const rule = css.slice(from);
    return rule.slice(0, rule.indexOf('}'));
  };

  it('reads the base breakpoint’s property outside any media query', () => {
    const base = css.slice(0, css.indexOf('@media'));
    expect(base).toContain(`aspect-ratio: var(${aspectRatioProperty('s')})`);
  });

  // The other end of the mechanism: `resolveAspectRatios` writes five
  // properties and the stylesheet has to read all five, or a breakpoint a
  // caller names would be silently inert.
  it.each(Object.entries(breakpointMinWidths))(
    'reads the %s property inside a min-width: %s query',
    (breakpoint, minWidth) => {
      expect(css).toContain(
        `@media (min-width: ${minWidth}) {\n  .ef-video-player {\n    aspect-ratio: var(${aspectRatioProperty(breakpoint as 'm')});`
      );
    }
  );

  it('declares a rule for every variant class the default styles name', () => {
    for (const { root } of Object.values(
      backpackVideoStyles.variants.variant
    )) {
      expect(css).toContain(`.${root} {`);
    }
  });

  it('does not hard-code an aspect ratio on the player box', () => {
    expect(css).not.toContain('aspect-ratio: 16 / 9;');
  });

  // Both halves are asserted because the first is what makes the second
  // load-bearing rather than decorative; the rule's own comment in
  // `backpack-video-styles.ts` is the argument, and this is only its guard.
  it('clears the player box’s own backdrop for an autoplaying video', () => {
    expect(css).toContain('background: #0b0e13;');
    expect(css).toContain(
      '.ef-video-player.ef-autoplay-video {\n  background: transparent;\n}'
    );
  });

  it('exposes the natural value it falls back to', () => {
    expect(naturalAspectRatio).toBe(naturalValue);
  });

  // `BackpackVideoHoverPreview` renders its cover layer as a sibling of the
  // player box rather than inside it, because `Player.Poster` cannot host a
  // cover that returns — its own file argues that at length. The layer therefore
  // has nothing positioning it, and these two rules are what make it a cover at
  // all rather than a block stacked above the video. Asserted here because a
  // deterministic story cannot see a stylesheet, and without them the component
  // is visibly broken while every one of its own tests still passes.
  it('lays the hover-preview cover over the player box', () => {
    // Sliced to the rule rather than searched for in the whole sheet. Both
    // declarations below happen to be unique strings in this file today, so a
    // file-wide `toContain` would fail if either were deleted — but it would pass
    // just as happily with the declaration sitting in some other rule, which is
    // the failure this test exists to catch. The neighbour below has always had
    // to slice, `pointer-events: none` appearing twice.
    //
    // Shrink-to-fit, so the root is the player's box and not the page's width:
    // `.ef-video-player` is given a fixed width, and a full-width root would
    // stretch an `inset: 0` cover well past the video.
    expect(ruleBody('.ef-video-hover-preview {')).toContain(
      'width: fit-content;'
    );
    // The layer sits over the media and under the play icon and the click
    // target, which is `Player.Poster`'s own z-index
    // (`packages/react/src/poster.tsx:55`) against the two rules above.
    expect(ruleBody('.ef-video-hover-preview > .ef-video-cover {')).toContain(
      'z-index: 10;'
    );
  });

  // The cover covers the button that plays the video, so a layer that took
  // pointer events would leave the resting surface with no working affordance.
  // `Player.Poster` sets the same property for the same reason
  // (`packages/react/src/poster.tsx:56`).
  it('lets clicks through the hover-preview cover', () => {
    expect(ruleBody('.ef-video-hover-preview > .ef-video-cover {')).toContain(
      'pointer-events: none;'
    );
  });
});

describe('resolveVariantClass', () => {
  it('is nothing without a variant', () => {
    expect(resolveVariantClass(undefined, undefined)).toBeUndefined();
  });

  it('resolves a variant to its own class', () => {
    expect(resolveVariantClass('outline', undefined)).toBe(
      'ef-video-variant-outline'
    );
    expect(resolveVariantClass('shadow-m', undefined)).toBe(
      'ef-video-variant-shadow-m'
    );
  });

  it('lets a theme config replace the active variant’s class', () => {
    expect(
      resolveVariantClass('outline', {
        variants: { variant: { outline: { root: 'story-override' } } }
      })
    ).toBe('story-override');
  });

  it('ignores an override aimed at a variant that is not active', () => {
    expect(
      resolveVariantClass('outline', {
        variants: { variant: { 'shadow-m': { root: 'story-override' } } }
      })
    ).toBe('ef-video-variant-outline');
  });

  it('has nothing to override when no variant is set', () => {
    expect(
      resolveVariantClass(undefined, {
        variants: { variant: { outline: { root: 'story-override' } } }
      })
    ).toBeUndefined();
  });
});
