import type { ComponentProps, ReactElement } from 'react';
import { createElement } from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Root, type RootProps } from '@playdeck/react';
import { ControlBar } from '@/components/BenchIsland';
import {
  useMockPlayer,
  type MockPlayerParameters
} from '../.storybook/mock-player';
import controlsMeta, { AssembledBar } from './controls.stories';
import themeMeta from './theme.stories';
import { available, ready } from './support';

/*
 * theme.css's control-surface wrap only splits the seek slider onto its own
 * row because the slider is the *first* composed child of `Controls` --
 * `flex: 1 1 100%` claims whatever line `flex-wrap` is about to fill next, and
 * that is line one only while nothing else has already taken it (theme.css,
 * "control surface"). Nothing enforces that order; the stylesheet comment is
 * the entire guarantee, and it has already failed twice, in two different
 * compositions. `BenchIsland`'s bar composed the slider third and shipped a
 * three-row, 156px control bar to the landing page, hotfixed in #610
 * (95d071b) with every other test green. `AssembledBar` below carried the
 * same defect, on the workbench rather than the live page, and nothing
 * surfaced it until this test.
 *
 * This test pins composed order, not layout, across every composition the
 * repository ships that puts a seek slider directly under `Controls`: this is
 * unit-level and DOM-only rather than layout-measuring, on purpose --
 * `e2e/site-bench.spec.ts`'s "the seek slider composes first" check (added by
 * #610) already covers the live page's rendered layout, and covers only that
 * one page. A composition that instead wraps its own rows in `<div>`s (the
 * archetype examples, `reference-player.tsx`) never puts the slider directly
 * under `Controls`, so the wrap rule does not bind it and it is out of scope
 * here -- reordering it would not change what CSS does.
 *
 * Lives beside `controls.stories.tsx` and `theme.stories.tsx` rather than in
 * `apps/site/test/`: two of the three compositions below are workbench
 * stories reached most naturally by a relative import from their own
 * directory, and the `@` alias this project's `vitest.config.ts` declares for
 * `apps/site/src` exists to reach the third (`BenchIsland`'s control bar) from
 * here -- there is no alias in the other direction. `.ts`, not `.tsx`, to
 * match every other file in this contract-test family: JSX is unavailable, so
 * elements are built with `createElement`.
 */

const source: RootProps['source'] = {
  type: 'video',
  sources: [
    { src: 'https://provider.invalid/mock-video.mp4', mimeType: 'video/mp4' }
  ]
};

/**
 * Mounts one composition under a `Player.Root` backed by the same mock
 * adapter the workbench stories use (`.storybook/mock-player`), staged with
 * the given capabilities/state so every capability-gated control the
 * composition renders actually resolves rather than sitting at `not-ready`.
 */
const renderComposition = (
  composition: () => ReactElement,
  parameters: MockPlayerParameters
) => {
  const Harness = () => {
    const ref = useMockPlayer(parameters);
    return createElement(Root, {
      children: createElement(composition),
      loading: 'interaction',
      ref,
      source
    });
  };
  return render(createElement(Harness));
};

interface Case {
  readonly name: string;
  readonly composition: () => ReactElement;
  readonly parameters: MockPlayerParameters;
}

// `AssembledBar.parameters` is typed through Storybook's own `Parameters`
// (an index signature, `{ [name: string]: any }`), so TS sees no overlap
// between that and the narrower shape this test needs -- routed through
// `unknown` rather than narrowed structurally, same as the runtime merge is:
// `fullyCapable`'s `player` really is there (asserted by the render below
// throwing if it were not).
const controlsParameters = {
  ...controlsMeta.parameters,
  ...AssembledBar.parameters
} as unknown as { player: MockPlayerParameters };

const cases: readonly Case[] = [
  {
    // The workbench's full-theme demo. Correct today: the fix this test
    // guards is the one below.
    name: 'theme.stories ThemedPlayer (workbench)',
    composition: () => createElement(themeMeta.component),
    parameters: themeMeta.parameters.player
  },
  {
    // The `Player/Controls` API demo. Composes the seek slider fourth before
    // #612's fix -- this is the case Red 1 is recorded against.
    name: 'controls.stories AssembledBar (workbench)',
    composition: () => controlsMeta.render(),
    parameters: controlsParameters.player
  },
  {
    // The landing page's own bar, built by mapping over `BENCH_CONTROLS`
    // (apps/site/src/bench-controls.ts). Correct today; Red 2 mutates that
    // tuple to prove this case is genuinely reached rather than passing
    // vacuously.
    name: 'BenchIsland ControlBar (site)',
    composition: () =>
      createElement<ComponentProps<typeof ControlBar>>(ControlBar, {
        fromKeyboardRef: { current: false }
      }),
    parameters: ready({ seek: available }).player
  }
];

afterEach(cleanup);

describe('the seek slider composes first wherever it is a direct child of controls', () => {
  // Guards against the suite silently shrinking: `it.each` below runs zero
  // cases -- and reports green -- if `cases` is ever emptied by accident, so
  // the count is pinned independently of the loop that consumes it.
  it('exercises all three compositions this rule binds', () => {
    expect(cases.map((c) => c.name)).toHaveLength(3);
  });

  it.each(cases)('$name', ({ composition, parameters }) => {
    const { container } = renderComposition(composition, parameters);
    const controls = container.querySelector('[data-playdeck-part="controls"]');
    // A composition that rendered no `controls` part at all would make the
    // index check below vacuous (every index, including -1, is `-1`), so this
    // is asserted on its own rather than folded into the `toBe(0)` below.
    expect(controls).not.toBeNull();
    const children = Array.from(controls!.children);
    const seekIndex = children.findIndex(
      (child) => child.getAttribute('data-playdeck-part') === 'seek-slider'
    );
    // Fails equally whether the slider is composed out of first place (the
    // #612 defect) or never rendered at all (a capability wired wrong here) --
    // both read as "not at index 0", and a composition in this list is one
    // this repo ships with the slider genuinely first.
    expect(seekIndex).toBe(0);
  });
});
