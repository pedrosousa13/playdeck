// `CompositionPanel.tsx`'s changed-line highlight duration, pulled into its
// own module so `e2e/site-bench.spec.ts` can import the same number for its
// poll budget instead of retyping it (#744).
//
// 900ms, read back off `base.css`'s `.line[data-changed]` transition rule's
// own literal rather than guessed at here would be nicer, but CSS has no way
// to hand a duration to JavaScript, so the two numbers are kept in sync by
// being next to each other in the two files' comments instead.
export const HIGHLIGHT_MS = 900;
