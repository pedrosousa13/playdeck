/*
 * The composition the two switches just built, printed beside them, now
 * highlighted, since `Bench.astro`'s frontmatter runs Shiki over all four
 * reachable (source, skin) pairs at build time and hands this component
 * already-rendered HTML rather than a plain string.
 *
 * One `<div dangerouslySetInnerHTML>` and no `<pre>` of its own: Shiki's own
 * `codeToHtml` output already IS a `<pre>`, carrying `astro-code`,
 * `data-bench-composition` and `tabindex="0"` from the `pre` transformer
 * `Bench.astro` adds, so a `<pre>` here would nest one inside another.
 *
 * `min-w-0` on this div: it is the element `BenchIsland.tsx`'s two-column
 * grid actually lays out (the `<pre>` inside is one level down), and a grid
 * item's automatic minimum size is its content's width unless something
 * clips or scrolls that item itself. The `<pre>` inside carries
 * `overflow-x: auto` from `.astro-code[data-bench-composition]`, but that
 * rule reaches the `<pre>`, not this wrapper, so without this the wrapper
 * refused to shrink below the unwrapped source's width and pushed the page
 * wider than the viewport at narrow widths -- measured: 233px of horizontal
 * overflow at 320px before this class was added.
 */
export type CompositionPanelProps = {
  /** One of `Bench.astro`'s four precomputed strings, picked by (source, skin). */
  readonly html: string;
};

export default function CompositionPanel({ html }: CompositionPanelProps) {
  return <div className="min-w-0" dangerouslySetInnerHTML={{ __html: html }} />;
}
