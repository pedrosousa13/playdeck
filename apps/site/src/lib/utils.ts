import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * shadcn's own `cn()`, unmodified: `clsx` resolves the usual conditional-class
 * shapes (strings, objects, arrays, falsy values dropped), and `twMerge`
 * follows behind it to resolve conflicting Tailwind utilities in favour of the
 * one written last — `"px-2 px-4"` becomes `"px-4"` rather than shipping both.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
