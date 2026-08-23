// WCAG 2.x non-text contrast, shared by the two checks that need it (#190):
// `theme.test.ts`, which composites the stylesheet's own token defaults, and
// `e2e/thumb-contrast.spec.ts`, which samples what a browser actually painted.
// One copy, because the two only corroborate each other if they compute the
// same number the same way -- and because the whole point of the rendered
// measurement is that it disagrees with the arithmetic in places.

export type Rgba = { red: number; green: number; blue: number; alpha: number };

/**
 * A `#rgb`, `#rrggbb` or `rgb(r g b / a)` CSS colour, in 0..1 channels.
 *
 * The throw names the value and not its source, which is a step back from the
 * `theme.css: cannot parse the colour default ...` this used to raise inside
 * `theme.test.ts` -- deliberately. The module is shared now and knows nothing
 * about the file a string came from, and threading a source through for the one
 * caller that has one buys less than it costs: that caller is `tokenDefault`,
 * whose own throw already names `theme.css` and the token, and vitest prints the
 * frame either way.
 */
export const parseColor = (value: string): Rgba => {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  if (hex !== null) {
    const digits = hex[1];
    const channel = (index: number): number =>
      digits.length === 3
        ? Number.parseInt(digits[index].repeat(2), 16) / 255
        : Number.parseInt(digits.slice(index * 2, index * 2 + 2), 16) / 255;
    return { red: channel(0), green: channel(1), blue: channel(2), alpha: 1 };
  }
  const rgb = /^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*\/\s*([\d.]+)\s*\)$/i.exec(
    value
  );
  if (rgb !== null)
    return {
      red: Number(rgb[1]) / 255,
      green: Number(rgb[2]) / 255,
      blue: Number(rgb[3]) / 255,
      alpha: Number(rgb[4])
    };
  throw new Error(`cannot parse the colour \`${value}\``);
};

/** An opaque colour from three 0..255 channels, the shape a screenshot has. */
export const fromChannels = (
  red: number,
  green: number,
  blue: number
): Rgba => ({ red: red / 255, green: green / 255, blue: blue / 255, alpha: 1 });

/** Source-over composite of a translucent colour onto an opaque ground. */
export const over = (color: Rgba, ground: Rgba): Rgba => {
  if (ground.alpha !== 1)
    throw new Error('the ground colour must be opaque to composite against');
  const blend = (top: number, bottom: number): number =>
    top * color.alpha + bottom * (1 - color.alpha);
  return {
    red: blend(color.red, ground.red),
    green: blend(color.green, ground.green),
    blue: blend(color.blue, ground.blue),
    alpha: 1
  };
};

/** WCAG 2.x relative luminance. Unexported: only `contrast` below needs it. */
const luminance = ({ red, green, blue }: Rgba): number => {
  const linear = (channel: number): number =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
};

/** WCAG 2.x contrast ratio, `(L1 + 0.05) / (L2 + 0.05)`. */
export const contrast = (one: Rgba, other: Rgba): number => {
  const [lighter, darker] = [luminance(one), luminance(other)].sort(
    (a, b) => b - a
  );
  return (lighter + 0.05) / (darker + 0.05);
};
