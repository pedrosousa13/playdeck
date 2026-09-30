import { expect, test, type Page } from '@playwright/test';
import {
  contrast,
  fromChannels,
  type Rgba
} from '../packages/react/test/contrast';

/**
 * WCAG AA on every ink-and-ground pair the site's two themes can produce
 * (#540).
 *
 * `apps/site/DESIGN.md` carries the tables this reproduces, and it used to rule
 * that there should deliberately be no standing check for them: the tables were
 * a record of a measurement, and whoever changed a value was to re-measure it
 * with a throwaway script over `packages/react/test/contrast.ts`. A throwaway
 * script describes the palette on the day it is run and gates nothing
 * afterwards, which is what a rule of that shape costs — the next edit to a
 * token takes a pair under its floor in silence, and the tables go on reporting
 * the figure the pair used to have. This file is the check that ruling declined
 * to build, and the section it sits in now says so.
 *
 * ---- why a browser rather than a parse of `tokens.css` -----------------------
 *
 * The value a pair actually gets is the value the cascade resolves, and in this
 * system that is not a lookup. `tokens.css` assigns the role tokens three times
 * — once on `:root`, once inside `@media (prefers-color-scheme: dark)` scoped
 * away from `[data-theme='light']`, and once under `[data-theme='dark']` — and
 * every role is a `var()` reference to a raw scale entry rather than a literal.
 * A re-parse would have to reimplement the cascade and custom-property
 * substitution to know which of the three assignments wins, and would then be
 * checking its own reimplementation as much as the stylesheet. Asking a browser
 * costs one `page.evaluate` and reimplements nothing.
 *
 * The colours are read off a real element rather than out of the custom
 * properties, so what is compared is the used value an engine resolved and
 * would paint — the same choice `e2e/site-theme.spec.ts` makes for the field.
 * Both members of the pair are read through `color` rather than one through
 * `color` and the other through `background-color`: a token resolves to the
 * same colour whichever property asks for it, contrast is symmetric, and one
 * property means one probe.
 *
 * ---- what is and is not covered ---------------------------------------------
 *
 * Every `--color-*` ink against every `--color-*` ground, in both themes, which
 * is a wider set than the pages currently draw. Measuring a pair no page has
 * used yet is the point of a gate over a token system: the roles are the
 * promise, and the page that first spends one of these combinations should not
 * be the thing that discovers it fails.
 *
 * The `--stage-*` roles are outside this gate and deliberately so. They are not
 * a theme: they never move with `data-theme` or `prefers-color-scheme`, they
 * belong to `Bench.astro` alone, and the capability inks drawn on them are the
 * dark theme's raw values rather than the `--color-*` roles this file reads.
 * `tokens.css` records their figures against `--stage-field` where it declares
 * them. A gate over them would be a different set of pairs, and is not this
 * ticket's.
 *
 * The syntax palette is covered too, at the foot of this file, and it is a
 * different shape: Shiki's colours are not `--color-*` roles and there is no
 * matrix of them, only eight inks per theme on the one ground a code block ever
 * has. It is measured here rather than recorded once in prose for the reason
 * the paragraph at the top of this file gives about the role tokens: a figure
 * written into a document is true on the day it is taken and gates nothing
 * afterwards.
 *
 * The site is served by the second `webServer` entry in `playwright.config.ts`.
 * The storybook one owns `baseURL`, so this address is written out rather than
 * navigated to as a path.
 */
const SITE = 'http://127.0.0.1:4322';

/**
 * The eight foregrounds, with what each one owes. Body text needs 4.5:1;
 * `--color-line-strong` is the boundary of a control and so is non-text UI,
 * which needs 3:1. `--color-line` is absent because it owes nothing — it
 * separates things a reader can already see are separate, which is the
 * distinction `DESIGN.md`'s palette section draws between the two lines.
 */
const FLOORS = {
  '--color-ink': 4.5,
  '--color-ink-muted': 4.5,
  '--color-ink-subtle': 4.5,
  '--color-accent': 4.5,
  '--color-available': 4.5,
  '--color-unknown': 4.5,
  '--color-unavailable': 4.5,
  '--color-line-strong': 3
} as const;

/** The five grounds: the surface ladder, sunken at the bottom, overlay at the top. */
const GROUNDS = [
  '--color-field',
  '--color-surface',
  '--color-sunken',
  '--color-raised',
  '--color-overlay'
] as const;

const INKS = Object.keys(FLOORS) as (keyof typeof FLOORS)[];

/**
 * A used `color`, which every engine reports as `rgb(r, g, b)` for an opaque
 * colour. None of the tokens read here carries an alpha channel — the only
 * entries in `tokens.css` that do are the shadow inks, and a shadow is neither
 * a foreground nor a ground — so a value in any other form is a change this
 * gate should stop rather than absorb.
 */
const parseUsedColor = (value: string): Rgba => {
  const match = /^rgba?\(\s*(\d+)\D+(\d+)\D+(\d+)\s*\)$/.exec(value);
  if (match === null) throw new Error(`not an opaque rgb colour: '${value}'`);
  return fromChannels(Number(match[1]), Number(match[2]), Number(match[3]));
};

/** Every ratio in one theme, keyed by the pair, as the page's engine resolves them. */
const measure = async (
  page: Page,
  theme: 'light' | 'dark'
): Promise<Map<string, number>> => {
  const painted = await page.evaluate(
    ({ chosen, tokens }: { chosen: string; tokens: string[] }) => {
      document.documentElement.dataset.theme = chosen;
      const probe = document.createElement('div');
      document.body.append(probe);
      const used: Record<string, string> = {};
      for (const token of tokens) {
        probe.style.color = `var(${token})`;
        used[token] = getComputedStyle(probe).color;
      }
      probe.remove();
      return used;
    },
    { chosen: theme, tokens: [...INKS, ...GROUNDS] }
  );

  const ratios = new Map<string, number>();
  for (const ink of INKS) {
    for (const ground of GROUNDS) {
      ratios.set(
        `${theme} ${ink} on ${ground}`,
        contrast(parseUsedColor(painted[ink]), parseUsedColor(painted[ground]))
      );
    }
  }
  return ratios;
};

test('every ink meets its floor on every ground, in both themes', async ({
  page
}) => {
  await page.goto(SITE);

  // Collected and asserted at the end rather than asserted pair by pair, so a
  // palette edit that moved several pairs reports all of them in one run. A
  // failing `expect` stops the test, and the second-worst pair would then only
  // appear after the first was fixed.
  const failures: string[] = [];
  for (const theme of ['light', 'dark'] as const) {
    for (const [pair, ratio] of await measure(page, theme)) {
      const floor = FLOORS[pair.split(' ')[1] as keyof typeof FLOORS];
      if (ratio < floor)
        failures.push(`${pair}: ${ratio.toFixed(2)} < ${floor}`);
    }
  }
  expect(failures).toEqual([]);
});

test('the tightest pair in each class is still the one DESIGN.md names', async ({
  page
}) => {
  // The floors above pass while a pair has any headroom at all, so on their own
  // they would let the system drift towards them without saying anything.
  // `DESIGN.md` names the two pairs that sit closest to their floor and quotes
  // both figures in prose; pinning them here is what makes that prose fail
  // rather than rot when a token moves. A change that improves either number is
  // a change that has to come with an edit to that document, which is the
  // intent — the tightest pair is a fact about the palette and the document is
  // where it is explained.
  await page.goto(SITE);

  const ratios = new Map([
    ...(await measure(page, 'light')),
    ...(await measure(page, 'dark'))
  ]);

  const tightest = (owed: number) =>
    [...ratios]
      .filter(
        ([pair]) => FLOORS[pair.split(' ')[1] as keyof typeof FLOORS] === owed
      )
      .sort(([, one], [, other]) => one - other)[0];

  const [text, textRatio] = tightest(4.5);
  expect(text).toBe('light --color-unavailable on --color-sunken');
  expect(textRatio.toFixed(2)).toBe('4.58');

  const [boundary, boundaryRatio] = tightest(3);
  expect(boundary).toBe('dark --color-line-strong on --color-overlay');
  expect(boundaryRatio.toFixed(2)).toBe('3.22');
});

/**
 * The syntax palette, which is the other set of inks this site paints and the
 * only one it does not own outright.
 *
 * `apps/site/src/shiki.ts` names `github-light` and `github-dark` and repaints
 * five of their colours, because a code block's ground here is `--color-sunken`
 * rather than either theme's own background and five entries did not clear 4.5
 * against it. What is written out below is the result: the eight colours each
 * theme paints on this site after that repaint. Restated rather than imported
 * from `src/shiki.ts`, for the reason `e2e/site-theme.spec.ts` restates the two
 * fields — a check that read its expectations from the module it is checking
 * would agree with it whatever it said, including after an Astro upgrade moved
 * a theme underneath the five overrides.
 *
 * Lower-case hex, because that is what `paintedHex` below produces and what
 * `src/shiki.ts` and `DESIGN.md` both speak.
 */
const SYNTAX = {
  light: [
    '#005cc5',
    '#032f62',
    '#176f2c',
    '#24292e',
    '#586069',
    '#6f42c1',
    '#a04100',
    '#cb2431'
  ],
  dark: [
    '#79b8ff',
    '#85e89d',
    '#959da5',
    '#9ecbff',
    '#b392f0',
    '#e1e4e8',
    '#f97583',
    '#ffab70'
  ]
} as const;

/**
 * The two pages measured, and they are two because the site highlights code
 * through two readers of `src/shiki.ts` that share no code path: `/examples`
 * passes it to Astro's `<Code>` component, and a reference page gets it from
 * `markdown.shikiConfig` by way of the rendered README. A repaint that reached
 * one and not the other would leave half the site failing.
 *
 * They are also the two pages that exercised the whole palette when they were
 * chosen. Which colours a page paints is a fact about what its document happens
 * to contain rather than a property of the palette, and no other page is held
 * to painting fewer — so that half is not asserted here, and this comment does
 * not enumerate what each page reached, because both would rot the first time a
 * fence gained a tag.
 *
 * What is asserted instead is the set, in both directions, on the two routes
 * below: everything painted is declared, and everything declared is painted. A
 * document edit that took the last tag out of a fence therefore fails here
 * loudly, rather than leaving this measuring seven colours and saying nothing
 * at all about the eighth.
 */
const HIGHLIGHTED = ['/examples/', '/reference/react/'] as const;

/** A used `rgb(...)` as the lower-case hex the palette above is written in. */
const paintedHex = (value: string): string => {
  const { red, green, blue } = parseUsedColor(value);
  return `#${[red, green, blue]
    .map((channel) =>
      Math.round(channel * 255)
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`;
};

/**
 * Every colour painted inside the code blocks of one page in one theme, and the
 * ground they are painted on.
 *
 * The ground is read off the block rather than from `--color-sunken`, so what
 * is measured is the panel a reader sees. `base.css` emits Shiki's own
 * `--shiki-light-bg` and `--shiki-dark-bg` and deliberately reads neither; a
 * block that started taking the theme's background would change every ratio
 * here and this is what would notice.
 *
 * `<pre>` and `<code>` are read alongside the token spans because the plain
 * text of a block takes its colour from the theme's foreground on the `<pre>`
 * rather than from a token of its own.
 */
const paintCodeBlocks = async (
  page: Page,
  theme: 'light' | 'dark'
): Promise<{ grounds: string[]; inks: string[] }> =>
  page.evaluate((chosen: string) => {
    document.documentElement.dataset.theme = chosen;
    const blocks = [...document.querySelectorAll('.astro-code')];
    const grounds = new Set<string>();
    const inks = new Set<string>();
    for (const block of blocks) {
      grounds.add(getComputedStyle(block).backgroundColor);
      for (const painted of [block, ...block.querySelectorAll('*')])
        inks.add(getComputedStyle(painted).color);
    }
    return { grounds: [...grounds], inks: [...inks] };
  }, theme);

test('the syntax palette is the one it is meant to be, and every colour in it meets AA', async ({
  page
}) => {
  // One test over both pages and both themes, collecting rather than asserting
  // as it goes, for the reason the matrix above does the same: a theme swap or
  // an Astro upgrade moves every colour at once, and a run that stopped at the
  // first would report one of them.
  const failures: string[] = [];
  const ratios = new Map<string, number>();

  for (const route of HIGHLIGHTED) {
    await page.goto(`${SITE}${route}`);
    for (const theme of ['light', 'dark'] as const) {
      const { grounds, inks } = await paintCodeBlocks(page, theme);
      const where = `${theme} ${route}`;

      expect(grounds, `${where}: one ground for every block`).toHaveLength(1);
      const ground = parseUsedColor(grounds[0]);

      // Keyed by hex so the palette can be compared against the list above and
      // a failure can be reported in the notation `src/shiki.ts` writes, while
      // the arithmetic still runs on the channels an engine reported.
      const painted = new Map(inks.map((ink) => [paintedHex(ink), ink]));
      expect([...painted.keys()].sort(), `${where}: the palette`).toEqual([
        ...SYNTAX[theme]
      ]);

      for (const [hex, ink] of painted) {
        const ratio = contrast(parseUsedColor(ink), ground);
        ratios.set(`${theme} ${hex}`, ratio);
        if (ratio < 4.5)
          failures.push(`${where} ${hex}: ${ratio.toFixed(2)} < 4.5`);
      }
    }
  }

  expect(failures).toEqual([]);

  // The tightest colour, pinned by name and by figure for the reason the
  // `--color-*` matrix pins its own two: the floor above passes while a colour
  // has any headroom at all, and `src/shiki.ts` argues at length that this red
  // is deliberately the one entry sitting closer to its floor than its
  // neighbours. A change that moves it is a change that has to come with an
  // edit to that argument and to `DESIGN.md`'s table.
  const [tightest, ratio] = [...ratios].sort(
    ([, one], [, other]) => one - other
  )[0];
  expect(tightest).toBe('light #cb2431');
  expect(ratio.toFixed(2)).toBe('4.83');
});
