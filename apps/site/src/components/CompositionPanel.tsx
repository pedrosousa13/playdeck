/*
 * The composition the three switches just built, printed beside them.
 *
 * It takes the string `buildComposition` returns and nothing else: the panel
 * knows what the switches produced, never what they are. Flipping a switch
 * rewrites this block, which is the argument -- the knobs are compositions and
 * not options.
 *
 * ---- why this block is not highlighted -----------------------------------
 *
 * It is the one code on this site that is not, and that is a measurement
 * rather than an oversight. Astro's `<Code>` is server-only and this panel
 * re-renders on every press, so highlighting here means shipping a highlighter
 * to the reader. The smallest one that could do it -- Shiki's
 * `createHighlighterCore` with the JavaScript regex engine, the `tsx` grammar
 * and the two themes `src/shiki.ts` names, nothing else -- measures 353.7 kB
 * raw and 72.5 kB gzipped, bundled with esbuild and minified. The engine and
 * core are 52.6 kB of that gzipped, the grammar 16.1 kB, the two themes 3.7 kB.
 *
 * The close of this page prints 17 kB as the gzipped size of every primitive
 * the library publishes, measured by the same module the budget gate uses. A
 * page that spent four times its own product to colour four keywords would be
 * arguing against itself in the object it was arguing with, so `/` prints this
 * block in `--color-ink` and the highlighter stays on the server, where the
 * reference pages and the two provider examples still use it. `DESIGN.md`'s
 * code section records the same fact in prose.
 *
 * The well is `--color-sunken`, which is one of the two things that token
 * exists for, and `base.css` already gives every `pre` the mono face at the
 * code rung, so this file writes neither. It scrolls rather than wraps, and it
 * is focusable, so a line too wide for the column is reachable from a keyboard
 * as well as from a trackpad -- the same treatment Astro gives a highlighted
 * fence.
 */
export type CompositionPanelProps = {
  /** The output of `buildComposition`, verbatim. */
  readonly composition: string;
};

export default function CompositionPanel({
  composition
}: CompositionPanelProps) {
  return (
    <pre
      data-bench-composition=""
      tabIndex={0}
      className="m-0 overflow-x-auto rounded-[var(--radius-md)] bg-[var(--color-sunken)] p-[var(--space-4)] leading-[var(--leading-snug)] text-[var(--color-ink)] [scrollbar-width:thin]"
    >
      <code>{composition}</code>
    </pre>
  );
}
