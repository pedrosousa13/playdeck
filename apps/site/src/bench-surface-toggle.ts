/*
 * The one decision `SurfaceToggle` (`BenchIsland.tsx`) makes about a tap on
 * the picture: whether this gesture should only wake the control bar, or
 * proceed to toggle playback the way `Player.PlayButton` always does.
 *
 * Pure and here rather than inline in the component for the same reason
 * `bench-quiet.ts` is: the failure this exists to catch is a moment in a
 * gesture sequence, and a moment is cheap to test against a function and
 * expensive to test against a mounted player with a real idle timer running.
 *
 * ---- the defect this closes (#598 follow-up) --------------------------------
 *
 * `SurfaceToggle` is `Player.PlayButton` with its box opened out to the whole
 * picture, so every tap on it both wakes the bar (a `pointerdown` bubbles to
 * `Viewport`'s own idle-reset listener before this component's click handler
 * ever runs) and toggles playback (`PlayButton`'s own `onClick`). On a coarse
 * pointer, with the bar hidden, that means the first tap after the bar faded
 * both reveals it AND pauses the clip the reader has not yet seen the
 * controls for -- two outcomes from one gesture, only one of which the reader
 * asked for.
 *
 * `revealsOnly` is the guard: true only when the pointer is coarse and the
 * bar was hidden the instant before this gesture, which is the one case a
 * tap should be read as "show me the controls" rather than "toggle
 * playback". Every other combination keeps the platform convention every
 * desktop player already follows -- a click both toggles playback and brings
 * the bar forward, because a mouse has no equivalent "the bar quietly faded
 * under a resting cursor" moment to protect against.
 */
export const revealsOnly = (
  coarsePointer: boolean,
  wasIdle: boolean
): boolean => coarsePointer && wasIdle;
