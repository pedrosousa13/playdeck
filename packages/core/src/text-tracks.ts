// `TextTrack.label` is a human label, so it must never be empty: providers
// hand their raw label through here and get a language-derived one back when
// there is nothing usable. A `<track srclang="en">` with no `label` would
// otherwise render a menu item with an empty accessible name.
//
// The language is rendered in itself ("français", not "French") wherever it
// has its own display data, which matches how caption menus name languages
// elsewhere. `fallback: 'none'` is what keeps that honest: without it, a code
// with no display name of its own gets one invented in the runtime's locale
// ("und" becomes "root", "mul" becomes "Multiple languages" or
// "multilingue"), so we take the raw code instead.
export const textTrackLabel = (
  label: string | null | undefined,
  language: string | null | undefined
): string => {
  const trimmedLabel = label?.trim();
  if (trimmedLabel) return trimmedLabel;
  const code = language?.trim();
  if (!code) return 'Unknown';
  try {
    return (
      new Intl.DisplayNames([code], {
        type: 'language',
        fallback: 'none'
      }).of(code) ?? code
    );
  } catch {
    // A malformed language tag throws; the raw code still beats an empty name.
    return code;
  }
};
