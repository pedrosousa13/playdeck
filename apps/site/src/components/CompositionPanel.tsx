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
 * `min-w-0` on this div: it is the element `BenchIsland.tsx`'s row actually
 * lays out (the `<pre>` inside is one level down), and a flex/grid item's
 * automatic minimum size is its content's width unless something clips or
 * scrolls that item itself. The `<pre>` inside carries `overflow-x: auto`
 * from `.astro-code[data-bench-composition]`, but that rule reaches the
 * `<pre>`, not this wrapper, so without this the wrapper refused to shrink
 * below the unwrapped source's width and pushed the page wider than the
 * viewport at narrow widths -- measured: 233px of horizontal overflow at
 * 320px before this class was added.
 *
 * ---- the changed-line highlight (2026-09-03) --------------------------
 *
 * `changedLines` names the 1-indexed lines that moved between the previous
 * composition and this one -- `BenchIsland.tsx` computes it by diffing the
 * plain source, since the highlighted HTML's own markup would make a text
 * diff noisy. This component's only job with it is to stamp `data-changed`
 * on the matching `.line[data-line="N"]` spans Shiki's own `line` hook
 * already wrote `data-line` onto, and to clear it again after the
 * transition `base.css`'s `.line[data-changed]` rule declares -- 900ms,
 * read back off that rule's own literal rather than guessed at here would
 * be nicer, but CSS has no way to hand a duration to JavaScript, so the two
 * numbers are kept in sync by being next to each other in the two files'
 * comments instead.
 *
 * The timeout is cleared and restarted on every `html`/`changedLines`
 * change, which is what "a second flip restarts the highlight" means: a
 * flip that lands before the previous highlight has cleared cancels that
 * clear and schedules a new one, rather than leaving two timers racing.
 */
import { useEffect, useRef } from 'react';

export type CompositionPanelProps = {
  /** One of `Bench.astro`'s four precomputed strings, picked by (source, skin). */
  readonly html: string;
  /** The 1-indexed lines that changed since the previous composition. */
  readonly changedLines: readonly number[];
};

const HIGHLIGHT_MS = 900;

export default function CompositionPanel({
  html,
  changedLines
}: CompositionPanelProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (root === null || changedLines.length === 0) return;

    for (const line of changedLines) {
      root
        .querySelector(`.line[data-line="${line}"]`)
        ?.setAttribute('data-changed', '');
    }

    const timeout = setTimeout(() => {
      for (const line of changedLines) {
        root
          .querySelector(`.line[data-line="${line}"]`)
          ?.removeAttribute('data-changed');
      }
    }, HIGHLIGHT_MS);

    return () => clearTimeout(timeout);
    // `html` in the dependency list, not only `changedLines`: React does not
    // re-run an effect for a new array with the same contents by identity,
    // but a `data-changed` line span exists only on the CURRENT `html`'s own
    // DOM, so a flip must re-run this even where `changedLines`
    // coincidentally holds the same numbers twice in a row.
  }, [html, changedLines]);

  return (
    <div
      ref={rootRef}
      className="min-w-0"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
