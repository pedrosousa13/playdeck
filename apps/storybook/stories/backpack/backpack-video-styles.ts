/**
 * The `BackpackVideo` wrapper's appearance, in one file: the story-local CSS
 * shared by its deterministic and its real-playback stories, the two mappings
 * that decide what the wrapper writes onto its own element for that stylesheet
 * to read, and the prop types those mappings take — the Backpack unions the
 * wrapper's public API restates. Behaviour parity is the goal of the wrapper,
 * so Backpack's styling stack (tailwind-variants plus its theme) is out of
 * scope; the class names are Backpack's own, which keeps the shape of the markup
 * comparable to the component this stands in for.
 *
 * `width` is the only thing the two sets disagree on, so it is the only
 * parameter.
 *
 * File references are into the Backpack v4 beta checkout at
 * `/Users/pedrosousa/Documents/apps/backpack/beta`.
 */

/**
 * Backpack's `AspectRatios` union (`src/additional-types.ts:193-211`), whole
 * and in its order. Whole because the mapping below is generic — one rule per
 * shape of value rather than one per value — so carrying every member costs
 * nothing, unlike {@link BackpackVideoVariant} and
 * {@link BackpackVideoPlayIconSize}, where each member is its own CSS rule.
 */
export type BackpackAspectRatio =
  | 'unset'
  | '1/1'
  | '2/1'
  | '3/2'
  | '16/9'
  | '18/9'
  | '2/3'
  | '4/3'
  | '3/4'
  | '9/16'
  | '9/18'
  | '21/9'
  | '5/4'
  | '4/5'
  | '3/1'
  | '1/2'
  | 'natural'
  | 'auto';

/** Backpack's breakpoint keys, its `BreakpointNames` (`src/additional-types.ts:233`). */
export type BackpackBreakpoint = 's' | 'm' | 'l' | 'xl' | 'xxl';

/**
 * Backpack's `BreakpointProp` (`src/components/hooks/useBackpackBreakpoints.tsx:43-45`).
 */
export type BackpackBreakpointProp<Value> = {
  readonly [Key in BackpackBreakpoint]?: Value;
};

/**
 * The two of Backpack's `videoStyles` variants its stories use
 * (`src/components/Video/video.styles.ts:18-20,24-26`). It also ships
 * `shadow-s` (`:21-23`), `shadow-l` (`:27-29`) and `shadow-xl` (`:30-32`); each
 * is a shadow token this stylesheet would have to approximate by hand and no
 * story would exercise, so they are left out rather than shipped untested.
 */
export type BackpackVideoVariant = 'outline' | 'shadow-m';

/**
 * Backpack's `VideoPlayIconSize` is `'s' | 'm' | 'l' | 'xl'`
 * (`src/components/Video/VideoPlayIcon.tsx:11`), of which `m` (its default)
 * and `xl` are what its stories use. `s` and `l` are omitted for the same
 * reason as the extra shadows: two more sizes of a hand-drawn glyph with
 * nothing asserting them.
 */
export type BackpackVideoPlayIconSize = 'm' | 'xl';

/**
 * The shape of Backpack's `themeConfig` narrowed to the one thing a story
 * needs to reach — the class string a variant puts on the root — so that
 * Backpack's own args copy across with a story-local class name in place of
 * its Tailwind (`stories/components/Video/Video.stories.tsx:398-419`). It is
 * deliberately not a theming system: there is one overridable field, and
 * {@link resolveVariantClass} is the whole of the merge.
 */
export type BackpackVideoThemeConfig = {
  readonly variants?: {
    readonly variant?: {
      readonly [Key in BackpackVideoVariant]?: { readonly root?: string };
    };
  };
};

/**
 * The wrapper's own default style object, in the shape Backpack's `videoStyles`
 * has, covering the part of it the wrapper actually resolves at runtime: the
 * root class and the variant classes a `themeConfig` may replace. Backpack's
 * `DefaultThemeConfig` story dumps its equivalent as JSON, and the wrapper's
 * story dumps this — so what is dumped is what the code reads, not a second
 * copy of it that can drift.
 */
export const backpackVideoStyles = {
  slots: { root: 'ef-video-player' },
  variants: {
    variant: {
      outline: { root: 'ef-video-variant-outline' },
      'shadow-m': { root: 'ef-video-variant-shadow-m' }
    }
  }
} as const;

/**
 * The class the root wears for `variant`, with a `themeConfig` override for
 * that same variant winning over it. Replacing rather than adding, because
 * Backpack's `deepMerge(videoStyles, themeConfig)` feeds one merged class
 * string to `tv` (`VideoPlayer.tsx:258-260`), whose `twMerge` drops the
 * utilities the override contradicts — `border-4 border-pink-base` leaves
 * nothing of `border border-mono-gray-300` standing. Two classes here would
 * instead have to win a specificity contest between two `<style>` elements,
 * which is not a thing a story should depend on.
 */
export const resolveVariantClass = (
  variant: BackpackVideoVariant | undefined,
  themeConfig: BackpackVideoThemeConfig | undefined
): string | undefined => {
  if (!variant) return undefined;
  return (
    themeConfig?.variants?.variant?.[variant]?.root ??
    backpackVideoStyles.variants.variant[variant].root
  );
};

/**
 * What `'natural'` resolves to, and the one place this wrapper deliberately
 * does not follow Backpack.
 *
 * Backpack's `'natural'` for a video is `aspect-video` — a fixed 16/9, not the
 * media's own ratio (`src/components/hooks/useAspectRatio.tsx:15-17`). Reely
 * can do better: `Player.Viewport` publishes the intrinsic ratio as
 * `--reely-media-aspect-ratio` once a provider measures its media
 * (`packages/react/src/viewport-media.tsx:44,49`), and reading it as
 * `aspect-ratio: var(--reely-media-aspect-ratio, 16 / 9)` is the consumer rule
 * ADR-0002 documents (`docs/adr/0002-published-measurements-are-outputs.md:58`).
 * That degrades to exactly Backpack's value — before anything is measured the
 * property is absent and the fallback applies — so this is Backpack's
 * behaviour plus the case Backpack gets wrong.
 */
export const naturalAspectRatio = 'var(--reely-media-aspect-ratio, 16 / 9)';

/** Backpack's default (`src/components/Video/VideoPlayer.tsx:78,189`). */
const defaultAspectRatios = {
  s: 'natural'
} as const satisfies BackpackBreakpointProp<BackpackAspectRatio>;

/**
 * The breakpoints that need a media query. `s` is absent because it is the
 * unprefixed base in Backpack's own map (`useAspectRatio.tsx:13-36`, against
 * `md:`/`lg:`/`xl:`/`xxl:` at `:37-128`) — so `s` is the no-query default and
 * is **not** its `sm:` 480px screen. The widths are its Tailwind screens
 * (`tailwind.config.cjs`: `sm:480px, md:768px, lg:1024px, xl:1264px,
 * xxl:1440px`), which is where `m` picks up `md`'s 768px.
 */
export const breakpointMinWidths: Record<
  Exclude<BackpackBreakpoint, 's'>,
  string
> = {
  m: '768px',
  l: '1024px',
  xl: '1264px',
  xxl: '1440px'
};

/**
 * Every breakpoint, narrowest first — which is the order both the carry-forward
 * in {@link resolveAspectRatios} and the media queries below depend on. Derived
 * from {@link breakpointMinWidths} rather than listed again, so the two cannot
 * disagree; the widths there are declared in ascending order and string keys
 * enumerate in insertion order.
 */
const breakpoints: readonly BackpackBreakpoint[] = [
  's',
  ...(Object.keys(breakpointMinWidths) as Array<
    Exclude<BackpackBreakpoint, 's'>
  >)
];

/** The custom property carrying one breakpoint's resolved ratio. */
export const aspectRatioProperty = (
  breakpoint: BackpackBreakpoint
): `--ef-video-aspect-${BackpackBreakpoint}` =>
  `--ef-video-aspect-${breakpoint}`;

const cssAspectRatio = (ratio: BackpackAspectRatio): string => {
  if (ratio === 'natural') return naturalAspectRatio;
  // `auto` and `unset` pass through as themselves. Backpack ships
  // `.aspect-unset { aspect-ratio: unset }` (seen in `tailwind.config.cjs`),
  // and a CSS-wide keyword substituted through `var()` still acts as that
  // keyword — `unset` on the non-inherited `aspect-ratio` is its initial
  // `auto`, which is what Backpack's class does too.
  if (ratio === 'auto' || ratio === 'unset') return ratio;
  return ratio.replace('/', ' / ');
};

/**
 * The custom properties the wrapper writes on its own element for the media
 * queries below to read: one per breakpoint, always all five.
 *
 * Every breakpoint is resolved here rather than left to the cascade, because a
 * `var()` with no fallback and no definition makes its whole declaration
 * invalid at computed-value time — so an unwritten property would not fall
 * through to the narrower breakpoint's rule, it would drop `aspect-ratio`
 * altogether. Carrying the last named value forward reproduces what Tailwind's
 * min-width prefixes do in Backpack: `{ s: '1/1', l: '16/9' }` there is
 * `aspect-1-1 lg:aspect-16-9`, so the `m` range still shows 1/1 — which is what
 * carrying `s` into `m` says. Breakpoints below the narrowest named one keep
 * Backpack's own default, `{ s: 'natural' }`.
 */
export const resolveAspectRatios = (
  aspectRatios:
    | BackpackAspectRatio
    | BackpackBreakpointProp<BackpackAspectRatio>
    | undefined
): Record<`--ef-video-aspect-${BackpackBreakpoint}`, string> => {
  const map: BackpackBreakpointProp<BackpackAspectRatio> =
    typeof aspectRatios === 'string'
      ? // Backpack applies a scalar as the unprefixed class alone
        // (`useAspectRatio.tsx:135-146`), which is the base and so every
        // breakpoint above it.
        { s: aspectRatios }
      : // An empty map is Backpack's own no-op (`useAspectRatio.tsx:147`).
        aspectRatios && Object.keys(aspectRatios).length > 0
        ? aspectRatios
        : defaultAspectRatios;

  let carried = cssAspectRatio(defaultAspectRatios.s);
  return Object.fromEntries(
    breakpoints.map((breakpoint) => {
      const named = map[breakpoint];
      if (named) carried = cssAspectRatio(named);
      return [aspectRatioProperty(breakpoint), carried];
    })
  ) as Record<`--ef-video-aspect-${BackpackBreakpoint}`, string>;
};

const aspectRatioMediaQueries = Object.entries(breakpointMinWidths)
  .map(
    ([breakpoint, minWidth]) => `
@media (min-width: ${minWidth}) {
  .ef-video-player {
    aspect-ratio: var(${aspectRatioProperty(breakpoint as Exclude<BackpackBreakpoint, 's'>)});
  }
}`
  )
  .join('\n');

export const backpackVideoCss = (width: string): string => `
.ef-video-player {
  position: relative;
  /* Backpack's boxes are all border-box, because it loads Tailwind's preflight
     (src/scss/base/_index.scss:1 is @tailwind base, and tailwind.config.cjs
     overrides neither preflight nor corePlugins), whose reset declares
     box-sizing: border-box on *, ::before and ::after. Declared on this rule
     rather than left to a reset, because this stylesheet is the whole of the
     wrapper's appearance and a story mounts it into whatever page it renders
     in. It is what the outline variant's border below is drawn inside of. */
  box-sizing: border-box;
  width: ${width};
  /* No fallback: BackpackVideo always writes all five properties, and the
     default it writes for them is the same 16/9 this box used to hard-code. */
  aspect-ratio: var(${aspectRatioProperty('s')});
  background: #0b0e13;
  border-radius: 0.25rem;
  overflow: hidden;
}

/* Backpack's root slot carries this whenever the autoplay class is present
   (video.styles.ts:5, [&.ef-autoplay-video]:bg-system-surface-transparent), and
   BackpackAutoplayVideo is the only thing that adds that class. Reproduced
   rather than skipped because it changes something here: the rule above fills
   the box, so without this an autoplaying player would show a dark backdrop
   wherever the video does not cover it — a letterboxed frame, or the gap before
   the first frame arrives — where Backpack's shows the page behind.

   The token resolves to rgba(255, 255, 255, 0) (tw-tokens.ts:143, reached from
   tw-colors-theme.preset.ts:256-257), a zero-alpha white. Written as the
   keyword rather than resolved by hand like the two variant tokens below,
   because at zero alpha the colour channels cannot be observed: the two
   composite identically against anything. A compound selector rather than the
   bare class, so the override wins on specificity instead of on where in this
   sheet it happens to sit. */
.ef-video-player.ef-autoplay-video {
  background: transparent;
}
${aspectRatioMediaQueries}

/* Backpack's outline and shadow-m variants (video.styles.ts:18-20,24-26) with
   their two tokens resolved by hand: --color-mono-gray-300 is
   rgb(191, 191, 191) and --shadow-shadow-dark-m-15 is
   0 2px 8px 0 rgba(26, 26, 26, 0.15). The border is drawn inside the box's
   declared width rather than added to it, here as there — see box-sizing
   above. */
.ef-video-variant-outline {
  border: 1px solid rgb(191, 191, 191);
}

.ef-video-variant-shadow-m {
  box-shadow: 0 2px 8px 0 rgba(26, 26, 26, 0.15);
}

/* Backpack sizes the icon through IconWrapper: m is a size-12 box with a 24px
   glyph and xl a size-16 box with a 32px one (VideoPlayIcon.tsx:22-39 maps the
   play-icon size onto IconWrapper's own size and iconSize, against
   Icon/icon-wrapper.styles.ts:46-48 for size-12 and :52-54 for size-16, with
   the glyphs at :66-68 and :69-71). m is the default, so 3rem is the resting
   size — the 4rem this file used to draw unconditionally was Backpack's xl. The
   triangle stands in for Phosphor's filled Play glyph, so its width is
   proportional rather than measured. */
.ef-video-play-icon {
  position: absolute;
  inset: 0;
  margin: auto;
  width: 3rem;
  height: 3rem;
  border-radius: 50%;
  background: rgba(232, 237, 244, 0.92);
  pointer-events: none;
  z-index: 20;
}

.ef-video-play-icon::after {
  content: '';
  position: absolute;
  inset: 0;
  margin: auto;
  width: 0;
  height: 0;
  border-style: solid;
  border-width: 0.75rem 0 0.75rem 1.25rem;
  border-color: transparent transparent transparent #0b0e13;
}

.ef-video-play-icon[data-play-icon-size='xl'] {
  width: 4rem;
  height: 4rem;
}

.ef-video-play-icon[data-play-icon-size='xl']::after {
  border-width: 1rem 0 1rem 1.6667rem;
}

/* Worn by the wrapper's toggle and by Player.ActivationButton, so the click
   target looks the same before and after the provider attaches. */
.ef-video-controller {
  appearance: none;
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
  z-index: 30;
}

.ef-video-controls {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  display: flex;
  gap: 0.5rem;
  padding: 0.5rem;
  z-index: 30;
}

/* Player.Poster already positions itself (inset: 0, z-index: 10); this only
   clips the hover zoom below to the cover's own bounds. */
.ef-video-cover {
  overflow: hidden;
}

.ef-video-cover-image {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  transform: scale(1);
  transition: transform 200ms ease;
}

/* Short transition so a story can hover and assert the settled transform
   under waitFor without a long wait. */
.ef-video-player:hover .ef-video-cover[data-hover-effect='true'] .ef-video-cover-image {
  transform: scale(1.05);
}
`;
