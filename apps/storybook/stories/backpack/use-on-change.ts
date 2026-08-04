import { useEffect, useRef, useState } from 'react';

/**
 * The two change-detection hooks the Backpack wrappers fold their state with.
 *
 * They lived in `backpack-video.tsx` until `BackpackVideoHoverPreview` needed the
 * second one, at which point that module was exporting a hook alongside a
 * component and keeping the hook's private sibling to itself — a wrapper doubling
 * as the family's hook library. One module per shared concern is what the rest of
 * this directory does (`off-screen-pause.ts`, `video-thumbnail.ts`,
 * `reporting-provider.ts`), so both moved here together rather than one being
 * exported and the other left behind.
 *
 * Both answer the same question — "is this value new?" — and differ in when the
 * answer is available, which is why they are a pair rather than one hook with an
 * option: {@link useChanged} answers during render, {@link useOnChange} after
 * commit.
 */

/**
 * True on the render that first sees a new `value`. The update is applied during
 * render rather than from an effect, so a caller's own state settles in the same
 * commit instead of a second one — the shape `Root` uses for its source
 * transition (`packages/react/src/root.tsx:158-160`, its
 * `if (sourceTransition.key !== sourceKeyForRender)`).
 */
export const useChanged = <Value>(value: Value): boolean => {
  const [seen, setSeen] = useState(value);
  if (Object.is(seen, value)) return false;
  setSeen(value);
  return true;
};

/** Runs `onChange` when `value` changes, never for the value it started with. */
export const useOnChange = <Value>(
  value: Value,
  onChange?: (value: Value) => void
): void => {
  const seen = useRef(value);
  useEffect(() => {
    if (Object.is(seen.current, value)) return;
    seen.current = value;
    onChange?.(value);
  }, [onChange, value]);
};
