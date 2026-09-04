/*
 * The two groups of switches under the bench's player: source and skin. One
 * position is active in each, and pressing one is the only way a reader changes
 * what the page is running.
 *
 * There was a third, `autoplay`, and it is gone rather than disabled. `/`
 * mounts its player with `loading="interaction"`, so the player can only start
 * from a user gesture and the browser then permits the audible attempt -- the
 * refusal and muted retry that switch existed to show could never happen here.
 * What was left was a control whose only effect was to add a prop to the
 * printed composition, which is a knob arguing by printing itself.
 *
 * Presentational, and deliberately so: it holds no player state, reads no
 * snapshot and mounts nothing. It is handed the two positions and two
 * callbacks, and `BenchIsland` is the one thing on this page that knows what a
 * controller is saying.
 *
 * ---- why these are radios and not buttons -------------------------------
 *
 * The three positions in a group are mutually exclusive, which is a radio
 * group and not a set of independent toggles. Three ways to say that were
 * available:
 *
 *   1. `<button aria-pressed>` per position. Every button becomes its own tab
 *      stop and each is announced as pressed or not pressed on its own, so the
 *      one fact that matters -- that choosing this one un-chooses that one --
 *      is the fact the markup does not carry.
 *   2. shadcn's `ToggleGroup`, which is Radix's: `role="radiogroup"` on the
 *      root, `role="radio"` on each item, roving focus and the arrow keys. It
 *      is the right semantics, and `radix-ui` is already a dependency, so it
 *      adds no entry to `package.json` -- but it does add code to the page.
 *      Measured with esbuild, `radix-ui`'s `ToggleGroup` (with React external)
 *      is 23.3 kB raw and 8.2 kB gzipped of client JavaScript.
 *   3. Native radios in a `<fieldset>` with a `<legend>`. Identical semantics,
 *      identical keyboard, zero bytes: the group, the roving focus, the arrow
 *      keys and the group's name from the legend are all the platform's.
 *
 * This is 3. `DESIGN.md` says what shadcn bought is behaviour that was
 * hand-rolled here before, and there is nothing to hand-roll: this behaviour
 * ships in the browser. Spending 8.2 kB to re-implement a radio group on a
 * page whose own argument is that the library it sells is 17 kB would be the
 * page contradicting itself in its own controls. A component is source in this
 * repository rather than a dependency, so adding one is a real decision with a
 * payload, and this one does not earn it.
 *
 * The visible pill is the `<label>`. The `<input>` sits inside it at
 * `inset: 0` with `appearance: none` and no paint of its own, so it is the
 * full size of the pill: the whole pill is its hit target, the site's one
 * `:focus-visible` outline in `base.css` draws around the pill without this
 * component restating a focus treatment, and `data-value` sits on the control
 * a test presses rather than on a wrapper standing in for one.
 *
 * ---- the contract the e2e specs read ------------------------------------
 *
 * `data-bench-switch` on each group root, `data-value` on each control. Both
 * are named in the plan for #542 and neither is to be renamed.
 */
import type { PlayerProvider } from '@playdeck/core';
import { readySources } from '@/bench-sources';
import type { SkinName } from '@/bench-composition';
import { cn } from '@/lib/utils';

type Position<T> = {
  /** The value handed back to the caller when this position is chosen. */
  readonly value: T;
  /** `data-value`, and the radio's own value. What a spec presses by. */
  readonly token: string;
  /** What the pill prints. */
  readonly label: string;
};

type GroupProps<T> = {
  /** `data-bench-switch`, and the radios' shared `name`. */
  readonly group: 'source' | 'skin';
  /** Tracked caps in mono at the 11px floor. A label, under the page's h1. */
  readonly legend: string;
  readonly positions: readonly Position<T>[];
  readonly selected: T;
  readonly onSelect: (value: T) => void;
};

function Group<T>({
  group,
  legend,
  positions,
  selected,
  onSelect
}: GroupProps<T>) {
  return (
    // Tailwind's preflight is not loaded on this site (see `tailwind.css`), so
    // the user agent's own fieldset border and legend padding are still there
    // to be turned off.
    <fieldset data-bench-switch={group} className="m-0 min-w-0 border-0 p-0">
      <legend className="p-0 font-mono text-[length:var(--text-fn)] tracking-[var(--tracking-fn)] text-[var(--color-ink-subtle)] uppercase">
        {legend}
      </legend>
      <div className="mt-[var(--space-2)] inline-flex flex-wrap gap-[2px] rounded-[var(--radius-md)] border-[length:var(--line-width)] border-solid border-[var(--color-line)] bg-[var(--color-sunken)] p-[2px]">
        {positions.map((position) => {
          const chosen = position.value === selected;
          return (
            // The two states are written as alternatives rather than as a rest
            // style a `:checked` variant paints over: two utilities setting the
            // same property differ only in source order once their selectors
            // tie on specificity, and which one Tailwind emits last is not this
            // file's to decide. Chosen here, where the answer is already known.
            <label
              key={position.token}
              className={cn(
                // The hairline is `var(--line-width)` and not Tailwind's bare
                // `border`, which is its own 1px. The two happen to be equal
                // today, which is exactly why the token has to be written: a
                // literal that agrees with a token by coincidence is the one
                // that stops agreeing silently. `index.astro` spells it the
                // same way for the install button and the close's rules.
                'relative inline-flex min-h-[var(--hit-target)] cursor-pointer items-center rounded-[calc(var(--radius-md)-2px)] px-[var(--space-4)] font-mono text-[length:var(--text-xs)] tracking-[var(--tracking-fn)]',
                chosen
                  ? 'bg-[var(--color-ink)] text-[var(--color-surface)]'
                  : 'text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]'
              )}
            >
              <input
                type="radio"
                name={`bench-${group}`}
                value={position.token}
                data-value={position.token}
                checked={chosen}
                onChange={() => onSelect(position.value)}
                className="absolute inset-0 m-0 cursor-pointer appearance-none border-0 bg-transparent"
              />
              {position.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export type BenchSwitchesProps = {
  readonly source: PlayerProvider;
  readonly skin: SkinName;
  readonly onSource: (value: PlayerProvider) => void;
  readonly onSkin: (value: SkinName) => void;
};

// `readySources` rather than `benchSources`: a provider with no clip this
// project may embed yet has no position at all, rather than a position that
// mounts a broken player. Turning one on is a three-character change in
// `bench-sources.ts` and this switch grows a control with nothing to remember.
const sourcePositions: readonly Position<PlayerProvider>[] = readySources.map(
  (entry) => ({
    value: entry.provider,
    token: entry.provider,
    label: entry.label
  })
);

const skinPositions: readonly Position<SkinName>[] = [
  { value: 'theme', token: 'theme', label: 'theme' },
  { value: 'docked', token: 'docked', label: 'docked' }
];

export default function BenchSwitches({
  source,
  skin,
  onSource,
  onSkin
}: BenchSwitchesProps) {
  return (
    <div className="flex flex-wrap items-end gap-[var(--space-5)]">
      <Group
        group="source"
        legend="SOURCE"
        positions={sourcePositions}
        selected={source}
        onSelect={onSource}
      />
      <Group
        group="skin"
        legend="SKIN"
        positions={skinPositions}
        selected={skin}
        onSelect={onSkin}
      />
    </div>
  );
}
