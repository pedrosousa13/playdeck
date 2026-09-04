/**
 * The "here is the file" disclosure under each composition on `/examples`,
 * rebuilt on shadcn's `Collapsible` for #542 phase 3. It replaces a native
 * `<details>`, on the maintainer's call that shadcn is the site's de facto
 * design system — see `SiteNavSheet.tsx` for the same swap made a phase
 * earlier, and for why the reasoning that reached for a platform element in
 * the first place (closed by default, keyboard-operable, announced state) is
 * satisfied by a Radix disclosure too.
 *
 * What the swap costs is stated plainly because it is real: a `<details>`
 * opens with no JavaScript and this does not. The maintainer took that trade
 * knowingly for both disclosures on this site. What it does not cost is the
 * source itself — see `forceMount` below.
 *
 * The highlighted code is not rendered here. `examples.astro` runs Shiki at
 * build time and passes the result as children, so this island ships the
 * disclosure and none of the highlighting, and the file is in the served HTML
 * whether or not React ever runs.
 */
import { ChevronRight } from 'lucide-react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@/components/ui/collapsible';

interface Props {
  /** The path of the file below, drawn in the mono face as its own label. */
  path: string;
  children: React.ReactNode;
}

export default function SourceDisclosure({ path, children }: Props) {
  return (
    <Collapsible>
      <CollapsibleTrigger className="group flex min-h-[var(--hit-target)] w-full items-center gap-[var(--space-2)] border-0 bg-transparent p-0 text-left font-mono text-[length:var(--text-sm)] text-muted-foreground hover:text-foreground">
        <ChevronRight
          aria-hidden="true"
          className="size-4 transition-transform duration-[var(--duration-fast)] group-data-[state=open]:rotate-90 motion-reduce:transition-none"
        />
        <code>{path}</code>
      </CollapsibleTrigger>

      {/*
       * `forceMount`, with the hiding left to Radix's own `hidden` attribute.
       * Without it a closed `Collapsible` renders nothing at all, which would
       * be a real loss rather than a detail: the file would be absent from the
       * served HTML, so a reader with no script would have no source on a page
       * whose whole claim is that the running player and its real source are
       * both here. `e2e/site-examples.spec.ts` reads a line out of the
       * closed well for the same reason. A native `<details>` kept its
       * contents in the DOM while closed and this keeps that property.
       *
       * The hiding is then this component's job rather than Radix's: with
       * `forceMount` it writes `data-state` and leaves the appearance alone, so
       * without the rule below a closed disclosure printed the whole file under
       * a control that said it was shut.
       */}
      <CollapsibleContent forceMount className="data-[state=closed]:hidden">
        {/* `source__well` is kept as the name of this box rather than replaced
         * by its utilities: it is what `e2e/site-examples.spec.ts` reads the
         * printed source through, and a class that says what the element is
         * survives a restyle in a way a list of utilities does not. */}
        <div className="source__well max-h-[32rem] overflow-auto [scrollbar-width:thin]">
          {children}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
