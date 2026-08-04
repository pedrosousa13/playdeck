/**
 * Backpack's `cn(...)` reduced to what these wrappers actually need: join the
 * names that are present, in the order given, and drop the rest.
 *
 * Backpack's own `cn` is `clsx` plus `tailwind-merge` (`src/cn.ts`), and the
 * merge half is what this deliberately leaves out — there are no Tailwind
 * utilities here to resolve conflicts between, only the wrapper's own class name
 * and the caller's, and a merge would add a dependency to a story workspace to
 * do nothing. What Backpack's callers rely on at the sites reproduced here is the
 * order alone: the component's class first, the caller's last
 * (`Video/VideoHoverPreview.tsx:115`, `Video/AutoplayVideo.tsx:28`).
 *
 * One module rather than a copy per composition, which is what it was: two
 * wrappers had the same `filter(Boolean).join(' ')` expression inline, free to
 * drift apart the moment either changed what counts as absent.
 */
export const composeClassName = (
  ...names: readonly (string | false | null | undefined)[]
): string => names.filter(Boolean).join(' ');
