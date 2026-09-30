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

// A numeric character reference (`&#38;`, `&#x26;`) can name a code point no
// UTF-16 string can hold — 0, a lone surrogate half, or anything past
// U+10FFFF. Mapped to U+FFFD, the replacement character, rather than left
// literal or thrown on: the same answer the WHATWG HTML numeric character
// reference algorithm gives an invalid one.
const decodeNumericCueEntity = (codePoint: number): string =>
  codePoint === 0 ||
  (codePoint >= 0xd800 && codePoint <= 0xdfff) ||
  codePoint > 0x10ffff
    ? '\ufffd'
    : String.fromCodePoint(codePoint);

// One regex, one pass: `String.replace` with a global pattern scans the
// original text once and substitutes into a fresh result, so a decoded
// replacement is never itself rescanned as a new match -- `&#x26;amp;`'s
// numeric half decodes to `&`, and the literal `amp;` beside it is untouched
// text with no leading `&` of its own, so the result is `&amp;`, not a
// second decode into `&`. A chain of sequential `.replace` calls does not
// have that guarantee: an earlier call's output can read as an entity to a
// later one, decoding the same reference twice.
const CUE_ENTITY = /&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|(amp|lt|gt|nbsp|lrm|rlm));/g;

// Decodes the character references cue authoring actually needs: the six
// named escapes above, plus decimal and hexadecimal numeric references
// (`&#38;`, `&#x26;`). WebVTT's cue-text parser's escape rule in fact
// consumes any HTML character reference, named or numeric, so a reference
// outside this list (`&quot;`, `&copy;`, ...) is spec-legal cue text and
// passes through here literally -- the tradeoff that keeps the full HTML
// named-character-reference table out of the bundle.
const decodeCueEntities = (text: string): string =>
  text.replace(
    CUE_ENTITY,
    (match, decimal?: string, hex?: string, named?: string): string => {
      if (decimal !== undefined) {
        return decodeNumericCueEntity(Number(decimal));
      }
      if (hex !== undefined) {
        return decodeNumericCueEntity(parseInt(hex, 16));
      }
      switch (named) {
        case 'amp':
          return '&';
        case 'lt':
          return '<';
        case 'gt':
          return '>';
        // A no-break space, not a plain one: captions use `&nbsp;`
        // precisely to stop the overlay breaking a line there.
        case 'nbsp':
          return '\u00a0';
        // Bidi marks — the whole reason they are escapable is that
        // right-to-left subtitles need them, so leaving them literal breaks
        // exactly the tracks that use them.
        case 'lrm':
          return '\u200e';
        case 'rlm':
          return '\u200f';
        default:
          return match;
      }
    }
  );

// A WebVTT cue's `text` payload is markup, not plain text: tag spans such as
// `<v Bob>`/`<i>...</i>` survive in it, and the grammar requires `&`/`<`/`>`
// in cue text to arrive escaped. This is what turns a provider's raw cue
// payload into what `TextCue.text`'s own doc comment promises. Tag spans are
// removed rather than rendered as formatting: the overlay draws text only.
export const plainCueText = (text: string): string =>
  decodeCueEntities(text.replace(/<[^>]*>/g, ''));
