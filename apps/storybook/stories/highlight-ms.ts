// `CompositionPanel.tsx`'s changed-line highlight duration, kept in its own
// module rather than a local const, since CSS has no way to hand a duration
// to JavaScript: the transition rule a consumer styles `[data-changed]` with
// has to agree with this number by hand.
export const HIGHLIGHT_MS = 900;
