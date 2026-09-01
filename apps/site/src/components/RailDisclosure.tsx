/**
 * The doc rail's disclosure: a closed "Contents" control on a narrow screen, a
 * permanently revealed column on a wide one.
 *
 * Rebuilt on shadcn's `Collapsible` for #542 phase 3, replacing the native
 * `<details>` and the inline script that used to force it open. shadcn is the
 * site's design system by the maintainer's call, and this is the last
 * hand-rolled disclosure on it — `SiteNavSheet.tsx` made the same swap for the
 * header a phase earlier, and `SourceDisclosure.tsx` for the archetype sources
 * beside this one.
 *
 * The trade is real and was taken knowingly: a `<details>` is a working closed
 * disclosure with no JavaScript at any width, and this is not. What does not
 * change is what a reader without a script *can* reach, because the rail's
 * links are rendered by Astro and passed in as children — they are in the
 * served HTML either way, and `forceMount` below keeps them in the DOM rather
 * than letting a closed disclosure delete them.
 *
 * ---- one state, written once ------------------------------------------------
 *
 * The old script owned two things it had to keep in step: whether the element
 * was open, which is what assistive technology is told, and `data-rail`, which
 * is what the stylesheet keyed the column layout off. Both are derived here
 * from one value, so they cannot disagree — at a narrow width a closed
 * disclosure with its control, at a wide one an open element with no control,
 * because there is nothing left for it to toggle.
 *
 * `useSyncExternalStore` rather than `useState` in an effect, because a media
 * query *is* an external store: it has a value to read and a change to
 * subscribe to, and reading it into state on mount would be a second copy of
 * something the platform already holds. Its server snapshot is `false`, so the
 * markup Astro renders is the closed disclosure, which is also what a reader
 * whose script never arrives is left looking at.
 *
 * `60rem` is the same figure as the media queries in `DocRail.astro`'s
 * stylesheet, and that duplication is worth naming rather than hiding: a CSS
 * media query cannot read a custom property, so there is no way to state this
 * breakpoint once. It was two places before this component and it is two
 * places now.
 */
import { useSyncExternalStore } from 'react';
import { ChevronRight } from 'lucide-react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@/components/ui/collapsible';

const COLUMN = '(min-width: 60rem)';

const subscribe = (onChange: () => void) => {
  const query = window.matchMedia(COLUMN);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};

export default function RailDisclosure({
  children
}: {
  children: React.ReactNode;
}) {
  const columned = useSyncExternalStore(
    subscribe,
    () => window.matchMedia(COLUMN).matches,
    () => false
  );

  return (
    <Collapsible
      // Open, and not merely revealed, once there is a column to put it in.
      // The distinction is the whole reason the old implementation needed a
      // script at all: CSS can show the content while leaving the element
      // closed, which tells a screen reader "collapsed" about a list its
      // reader is looking at. `open` is a property and the accessible state
      // follows it, so the property is what gets set.
      open={columned ? true : undefined}
      data-rail={columned ? 'column' : 'disclosure'}
      className="min-[60rem]:h-full"
    >
      {/* Absent rather than hidden at column width. A control that toggles
       * nothing is not something to hide from sight and leave in the tab
       * order. */}
      {!columned && (
        <CollapsibleTrigger className="group mb-[var(--space-4)] flex min-h-[var(--hit-target)] w-full items-center gap-[var(--space-3)] rounded-[var(--radius-md)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-[var(--space-3)] text-[length:var(--text-sm)] font-semibold text-[var(--color-ink)] hover:text-[var(--color-accent)] active:text-[var(--color-ink-subtle)]">
          <ChevronRight
            aria-hidden="true"
            className="size-3 text-[var(--color-ink-subtle)] transition-transform duration-[var(--duration-fast)] group-data-[state=open]:rotate-90 motion-reduce:transition-none"
          />
          Contents
        </CollapsibleTrigger>
      )}

      {/* `forceMount`, so the rail's links are in the DOM whether it is open or
       * not, exactly as a closed `<details>` kept its own.
       *
       * Which means this has to do the hiding. Without `forceMount` Radix
       * unmounts closed content and there is nothing on screen because there is
       * nothing at all; with it, Radix only writes `data-state` and leaves the
       * appearance to CSS, on the assumption that whoever asked for the element
       * to stay wants to animate it. Measured without the rule below: the
       * control said "collapsed" and the whole rail was on screen underneath
       * it, which is precisely the disagreement between the announced state and
       * the visible one that this disclosure exists to avoid. */}
      <CollapsibleContent
        forceMount
        className="data-[state=closed]:hidden min-[60rem]:h-full"
      >
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}
