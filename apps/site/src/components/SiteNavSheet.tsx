/**
 * The mobile collapse for the site's three destinations, rebuilt on shadcn's
 * `Sheet` for #542 phase 2. It replaces the `<details>` disclosure
 * `SiteHeader.astro` used to reach for at the same breakpoint (40rem) — see
 * that file's own history for why a disclosure was the right shape before
 * shadcn was the mandate; the reasoning that put it there (closed by default,
 * keyboard-operable, no second implementation of a focus trap) is exactly
 * what a `Sheet` buys too, built on a Radix dialog rather than the platform's
 * own element.
 *
 * The three links are Astro-rendered in `SiteHeader.astro` and passed here as
 * plain data, not re-derived: `aria-current` is decided once, server-side,
 * from `Astro.url.pathname`, and this island only has to draw what it is
 * told. That is also why this component does not itself decide which
 * destination is current — a second computation of the same fact is a second
 * place for it to drift from the first.
 *
 * `e2e/site-nav.spec.ts` reads the header's destinations through
 * `nav(page).getByRole('link')`, scoped to the `nav[aria-label="Site"]`
 * landmark `SiteHeader.astro` renders around the inline list. This sheet's
 * content is portalled to `document.body` by default (unlike
 * `SearchCommand`, which portals into its own wrapper for the axe scan) and
 * only mounts once opened, so it never appears inside that landmark and never
 * doubles the set of links the test counts — the same reason the old
 * `<details>` version kept one list rather than two.
 */
import { Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger
} from '@/components/ui/sheet';

interface Destination {
  label: string;
  href: string;
  current: boolean;
}

export default function SiteNavSheet({
  destinations
}: {
  destinations: Destination[];
}) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Site navigation"
          className="min-[40rem]:hidden"
        >
          <Menu aria-hidden="true" />
        </Button>
      </SheetTrigger>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>Playdeck</SheetTitle>
        </SheetHeader>
        <ul className="m-0 flex list-none flex-col gap-[var(--space-1)] px-[var(--space-4)]">
          {destinations.map(({ label, href, current }) => (
            <li key={href}>
              <a
                href={href}
                aria-current={current ? 'page' : undefined}
                className="block min-h-[var(--hit-target)] content-center rounded-[var(--radius-md)] px-[var(--space-3)] text-[length:var(--text-md)] font-semibold text-foreground no-underline aria-[current=page]:text-primary hover:bg-secondary"
              >
                {label}
              </a>
            </li>
          ))}
        </ul>
      </SheetContent>
    </Sheet>
  );
}
