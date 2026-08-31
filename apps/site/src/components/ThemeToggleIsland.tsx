/**
 * The theme switch, rebuilt on shadcn's `DropdownMenu` for #542 phase 2.
 *
 * The three-state model this site has always had — light, dark, and "follow
 * the operating system" — was flattened into a two-position switch in the
 * version this replaces, because a switch only has two positions. A menu does
 * not have that limitation, so the third state (no stored preference, which is
 * what `Base.astro`'s pre-paint script and `tokens.css`'s `prefers-color-scheme`
 * block already treat as "unset") is now a real, selectable option rather than
 * something a reader could only reach by clearing their own storage.
 *
 * `data-theme` on `<html>` stays the one mechanism. Choosing "Light" or "Dark"
 * writes it (and mirrors the write to `localStorage`, same key
 * `Base.astro`'s pre-paint script and this file both read); choosing "System"
 * removes the attribute, which is exactly what hands the decision back to
 * `tokens.css`'s media-query block. shadcn's own components assume a `.dark`
 * class rather than an attribute — this file does not add one. `--color-*`
 * roles already flip on `[data-theme]` in `tokens.css`, and every shadcn
 * variable in `shadcn-theme.css` is a `var()` reference onto one of those
 * roles, so nothing here needs a second theme mechanism to agree with the
 * first.
 */
import { useState } from 'react';
import { Moon, Sun, SunMoon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@/components/ui/tooltip';

// Duplicated from `Base.astro`'s pre-paint script, and the two have to stay
// identical for the reason given there: change one and the theme still
// switches on a click but silently stops surviving a reload.
const STORAGE_KEY = 'playdeck-theme';

type Choice = 'light' | 'dark' | 'system';

const OPTIONS: { value: Choice; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: SunMoon }
];

/** What `data-theme` on the root currently reads, read fresh on every call. */
const readChoice = (): Choice => {
  const stored = document.documentElement.dataset.theme;
  return stored === 'light' || stored === 'dark' ? stored : 'system';
};

export default function ThemeToggleIsland() {
  // Read once, lazily, rather than in an effect: this island is mounted
  // `client:only="react"` (see `ThemeToggle.astro`), so it never runs on the
  // server and `document` is always available the first time this function
  // body executes — there is no server-rendered guess to flash past.
  const [choice, setChoice] = useState<Choice>(readChoice);

  const apply = (next: Choice) => {
    const root = document.documentElement;
    if (next === 'system') {
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', next);
    }
    try {
      if (next === 'system') {
        window.localStorage.removeItem(STORAGE_KEY);
      } else {
        window.localStorage.setItem(STORAGE_KEY, next);
      }
    } catch {
      // A reader who blocks storage still gets the switch, for this page
      // view only.
    }
    setChoice(next);
  };

  const current =
    OPTIONS.find((option) => option.value === choice) ?? OPTIONS[2];
  const CurrentIcon = current.icon;

  return (
    <TooltipProvider>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={`Theme: ${current.label}`}
                data-theme-toggle
              >
                <CurrentIcon aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Theme: {current.label}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end">
          {OPTIONS.map(({ value, label, icon: Icon }) => (
            <DropdownMenuItem
              key={value}
              onSelect={() => apply(value)}
              aria-checked={choice === value}
              role="menuitemradio"
            >
              <Icon aria-hidden="true" className="text-muted-foreground" />
              {label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </TooltipProvider>
  );
}
