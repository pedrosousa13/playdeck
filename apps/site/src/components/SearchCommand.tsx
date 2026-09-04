/**
 * Search over the documentation, rebuilt on shadcn's `Command` (cmdk) inside a
 * `Dialog` for #542 phase 2. See `DocsSearch.astro` for why Pagefind, what
 * gets indexed, and the two origins the e2e suite exercises this against —
 * none of that changed. What changed is the chrome: a `<dialog>` and a
 * hand-rolled combobox become a `Dialog` and `Command`, and everything below
 * is about making that swap without losing a single behaviour the old
 * component had.
 *
 * ---- the two things `Command` does not do for this component ---------------
 *
 * `shouldFilter={false}`: `Command`'s own filtering matches its rendered
 * items against the text typed into `CommandInput`. This component's items
 * are not a fixed list to filter — they are the outcome of a Pagefind query
 * run for every keystroke — so `Command`'s filter would be a second,
 * redundant pass over results Pagefind already ranked, and one liable to hide
 * a sub-result whose title does not literally contain the query.
 *
 * Controlled selection (`value`/`onValueChange` on `Command`, not left to its
 * own defaults): `Command` tracks which item is selected by watching which
 * items are mounted, and this component's whole result list unmounts and
 * remounts on every keystroke (React reconciles by key, and the key is each
 * result's URL). Left to its own bookkeeping, `Command` does not reliably
 * re-select "the first result" out of a wholly new set — it only reaches for
 * a new first item when the previously-selected one happens to be the item
 * that got removed, which is an accident of unmount order rather than a rule.
 * Selection is therefore driven by this component, in `render()` below, the
 * same place the old implementation's `highlight(0)` call was.
 *
 * ---- what a result actually is ----------------------------------------------
 *
 * Every `CommandItem` below is rendered `asChild` around a real `<a href>`.
 * Radix's `Slot` (which `asChild` reaches for) merges `Command`'s own props —
 * `role="option"`, `aria-selected`, the click handler that fires `onSelect`
 * — onto that anchor rather than wrapping it in a second element, so the
 * element the accessibility tree calls an option is the same element a
 * pointer can middle-click or open in a new tab. `e2e/site-search.spec.ts`
 * reads `href` directly off `getByRole('option')`, which only holds if the
 * option *is* the anchor.
 *
 * ---- the keyboard -------------------------------------------------------
 *
 * `/` opens and focuses, but the listener for it is not here: it lives inline
 * in `DocsSearch.astro` so that it is attached while the document parses
 * rather than when this island hydrates, which a measurement in that file
 * shows is late enough to drop a press. This component only listens for the
 * event that script dispatches.
 *
 * Arrow keys and Enter are `Command`'s own: it already implements "move the
 * controlled selection" and "dispatch a select event at the selected item",
 * which is exactly the combobox behaviour the old implementation wrote by
 * hand. Escape is `Dialog`'s, and dismissing on it is most of why this is a
 * Radix dialog, same as the old component's reason for reaching for
 * `<dialog>`. Where focus goes afterwards is *not* left to it: measured, a
 * dialog dismissed with Escape here left focus on `<body>`, so both ends of
 * the focus journey are set explicitly on `DialogContent` below.
 */
import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import {
  Command,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command';

/** How many results the list shows. */
const LIMIT = 8;

/** How many headings one document may contribute to that list — see
 * `flatten` below for why a per-document cap exists at all. */
const PER_PAGE = 2;

/** Pagefind's own debounce. */
const DEBOUNCE_MS = 180;

interface Entry {
  title: string;
  url: string;
  excerpt: string;
}

/*
 * The Pagefind bundle is generated at build time and has no types to import,
 * so this describes only the members this file calls. See `DocsSearch.astro`
 * — now this file's neighbour rather than its own body — for what that buys
 * and what it does not.
 */
interface PagefindResultData {
  url: string;
  excerpt: string;
  meta: { title?: string };
  sub_results?: { title: string; url: string; excerpt: string }[];
}

interface Pagefind {
  options: (options: { baseUrl: string }) => Promise<void>;
  init: () => Promise<void>;
  debouncedSearch: (
    query: string,
    options: Record<string, never>,
    debounce: number
  ) => Promise<{
    results: { data: () => Promise<PagefindResultData> }[];
  } | null>;
}

/** A document is one result and its headings are its sub-results — see the
 * doc comment this carried in `DocsSearch.astro` for the reasoning behind the
 * per-document cap. */
const flatten = (data: PagefindResultData): Entry[] => {
  const subs = (data.sub_results ?? []).slice(0, PER_PAGE);
  if (subs.length === 0) {
    return [
      {
        title: data.meta.title ?? data.url,
        url: data.url,
        excerpt: data.excerpt
      }
    ];
  }
  return subs.map((sub) => ({
    title: sub.title,
    url: sub.url,
    excerpt: sub.excerpt
  }));
};

interface Props {
  /**
   * `import.meta.env.BASE_URL`, read in `DocsSearch.astro` and passed down
   * rather than read here: this file is real TypeScript under
   * `apps/site/tsconfig.json`, whose `types` array is deliberately empty (see
   * that file's own comment), so it carries no ambient `ImportMetaEnv`
   * declaration. `HeroPlayer.astro` resolves the same global the same way,
   * for its clip and captions URLs, and passes it to `HeroPlayerIsland.tsx`
   * as a prop rather than a second read.
   */
  base: string;
}

export default function SearchCommand({ base }: Props) {
  const bundle = `${base}pagefind/pagefind.js`;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [selected, setSelected] = useState('');
  const [status, setStatus] = useState('');
  const [broken, setBroken] = useState(false);

  const openerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // State rather than a ref: `DialogContent` below reads this during render
  // to choose where its portal mounts, and a ref's `.current` is not a value
  // React allows a component to read while rendering. Set via the `.search`
  // wrapper's `ref` callback, which runs once the element exists.
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  /* Loaded on the first query and not before — see `DocsSearch.astro` for
   * the measured cost a reader who never searches is spared. Holding the
   * promise is what makes a second query reuse the first one's load. */
  const loadingRef = useRef<Promise<Pagefind> | undefined>(undefined);

  const load = () => {
    loadingRef.current ??= (async () => {
      const pagefind = (await import(/* @vite-ignore */ bundle)) as Pagefind;
      await pagefind.options({ baseUrl: base });
      await pagefind.init();
      return pagefind;
    })();
    return loadingRef.current;
  };

  const render = (forQuery: string, found: Entry[]) => {
    setEntries(found);
    setSelected(found[0]?.url ?? '');
    setBroken(false);
    if (forQuery === '') {
      setStatus('');
    } else if (found.length === 0) {
      setStatus(`No results for “${forQuery}”.`);
    } else {
      setStatus(
        `${found.length} result${found.length === 1 ? '' : 's'} for “${forQuery}”.`
      );
    }
  };

  const run = async (nextQuery: string) => {
    if (nextQuery === '') {
      render('', []);
      return;
    }

    let pagefind: Pagefind;
    try {
      pagefind = await load();
    } catch {
      render(nextQuery, []);
      setBroken(true);
      return;
    }

    const search = await pagefind.debouncedSearch(nextQuery, {}, DEBOUNCE_MS);
    if (search === null) return; // superseded by a later keystroke
    if (
      inputRef.current !== null &&
      inputRef.current.value.trim() !== nextQuery
    )
      return;

    const pages = await Promise.all(
      search.results.slice(0, LIMIT).map((result) => result.data())
    );
    render(nextQuery, pages.flatMap(flatten).slice(0, LIMIT));
  };

  const handleQueryChange = (value: string) => {
    setQuery(value);
    void run(value.trim());
  };

  const openDialog = () => setOpen(true);

  /*
   * The `/` shortcut, which this component listens for but does not define:
   * the predicate for what counts as a search-opening keypress lives in
   * `DocsSearch.astro`'s inline script, because it has to be attached before
   * this island hydrates or an early press is lost. See that file for the
   * measurement.
   *
   * One event, for every press, including one made before this listener
   * existed. A press from that gap is held by the script and replayed once
   * this announces itself ready, so there is one way into the dialog rather
   * than an event for the ordinary case and a flag read at mount for the early
   * one. Which also keeps every `setOpen` here inside an event callback, where
   * a subscription's state changes belong.
   */
  useEffect(() => {
    document.addEventListener('playdeck:search-open', openDialog);
    document.dispatchEvent(new CustomEvent('playdeck:search-ready'));
    return () =>
      document.removeEventListener('playdeck:search-open', openDialog);
  }, []);

  /*
   * `aria-activedescendant`, which `Command` does not set for the selection
   * this component makes.
   *
   * `Command` keeps the id of its selected item in its own store and puts it
   * on the input, but only recomputes it on the store write its arrow keys go
   * through. Measured, on the results of a fresh query: the first result
   * carries `aria-selected="true"` and the input names nothing, and the first
   * press of ArrowDown fixes both at once. Measured with the selection left to
   * `Command` entirely, with this component's `value` prop removed: the same.
   * So it is the first selection over a new list that goes unannounced, either
   * way, rather than anything about driving the selection from here.
   *
   * Which is the one moment the announcement matters most. A reader following
   * the input is told nothing about the result Enter would open, and the fix
   * for that is not to stop selecting a first result — it is to say which one.
   *
   * Read off the DOM rather than tracked here because the id belongs to
   * `Command`: it generates one per item and its own generated id wins over any
   * passed in, so the element is the only place it exists. Written imperatively
   * for the same reason — `Command` sets this attribute after any prop given to
   * `CommandInput`, so a prop cannot reach it.
   *
   * Driven by an observer rather than by this component's own state, because
   * the state is not what it has to stay in step with. `Command` moves
   * `aria-selected` in an effect of its own, one commit after the render that
   * changed the results, so an effect keyed on `entries` reads the list before
   * anything in it is selected and writes nothing. What this has to mirror is
   * the attribute itself, so that is what it watches.
   */
  useEffect(() => {
    if (container === null) return;

    const sync = () => {
      // Read through the ref on every call rather than once when the observer
      // is set up: `Dialog` mounts its content in a later commit than the one
      // that opens it, so at setup time there is no input yet, and an effect
      // that gave up on that would never run again — `container` and `open`
      // are both already settled by then.
      const input = inputRef.current;
      if (input === null) return;
      const item = container.querySelector('[cmdk-item][aria-selected="true"]');
      if (item === null) {
        input.removeAttribute('aria-activedescendant');
        return;
      }
      // Only when it actually differs: this writes into the subtree the
      // observer below is watching, and an unconditional write on an
      // unchanged value would have it wake itself forever.
      if (input.getAttribute('aria-activedescendant') !== item.id) {
        input.setAttribute('aria-activedescendant', item.id);
      }
    };

    const observer = new MutationObserver(sync);
    observer.observe(container, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['aria-selected']
    });
    sync();
    return () => observer.disconnect();
  }, [container]);

  return (
    <div className="search" ref={setContainer}>
      <button
        ref={openerRef}
        type="button"
        aria-haspopup="dialog"
        data-search-open
        onClick={openDialog}
        className="flex min-h-[var(--hit-target)] items-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-input bg-secondary px-[var(--space-3)] font-sans text-[length:var(--text-sm)] text-muted-foreground hover:text-foreground"
      >
        <Search aria-hidden="true" className="size-4" />
        <span>Search</span>
        <kbd className="hidden rounded-[var(--radius-sm)] border border-border px-[var(--space-1)] text-[length:var(--text-fn)] text-muted-foreground min-[40rem]:inline">
          /
        </kbd>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          container={container ?? undefined}
          className="max-w-[38rem] gap-0 border-0 bg-card p-0 shadow-[var(--elevation-panel)]"
          /* Both ends of the focus journey, stated here rather than half
           * inherited. `Dialog` moves focus on its own at each end, and this
           * component overrides both: on the way in, so focus lands in the
           * search field rather than on the first focusable thing in the
           * dialog; on the way out, so it lands back on the control that
           * opened it. The second is not decoration — measured, a dialog
           * dismissed with Escape left focus on `<body>`, which strands a
           * reader who navigates by keyboard at the top of the document with
           * their place in the page lost. */
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            inputRef.current?.focus();
            inputRef.current?.select();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            openerRef.current?.focus();
          }}
        >
          <DialogHeader className="sr-only">
            <DialogTitle>Search the documentation</DialogTitle>
            <DialogDescription>
              Search the package references, provider setup guides and examples.
            </DialogDescription>
          </DialogHeader>

          <Command
            shouldFilter={false}
            value={selected}
            onValueChange={setSelected}
          >
            <CommandInput
              ref={inputRef}
              value={query}
              onValueChange={handleQueryChange}
              placeholder="Search the documentation"
              className="text-[length:var(--text-md)]"
            />

            {/* The result count, announced — see `DocsSearch.astro` for why
             * this exists at all: a listbox that changes under a reader who
             * cannot see it says nothing on its own. */}
            <p
              role="status"
              className="px-[var(--space-3)] pt-[var(--space-2)] font-mono text-[length:var(--text-fn)] text-muted-foreground"
            >
              {broken ? 'Search is unavailable on this page.' : status}
            </p>

            <CommandList className="max-h-[20rem] px-[var(--space-2)] pb-[var(--space-2)]">
              {entries.map((entry) => (
                <CommandItem
                  key={entry.url}
                  value={entry.url}
                  asChild
                  onSelect={() => {
                    window.location.href = entry.url;
                  }}
                >
                  <a
                    href={entry.url}
                    className="grid gap-[var(--space-1)] rounded-[var(--radius-md)] px-[var(--space-3)] py-[var(--space-2)] text-foreground no-underline data-[selected=true]:bg-secondary"
                  >
                    <span className="font-semibold">{entry.title}</span>
                    <span
                      className="line-clamp-3 text-[length:var(--text-sm)] text-muted-foreground [&_mark]:bg-transparent [&_mark]:font-semibold [&_mark]:text-primary"
                      // Pagefind wraps the matched words in `<mark>`, escaping
                      // its own source (this site's built pages) on the way
                      // in — there is no path by which a reader's query
                      // becomes markup here. Unchanged from `DocsSearch.astro`.
                      dangerouslySetInnerHTML={{ __html: entry.excerpt }}
                    />
                  </a>
                </CommandItem>
              ))}
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>
    </div>
  );
}
