import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Tailwind-aware class concatenator. shadcn-style — combines clsx's truthy
 * filtering with twMerge so later `bg-emerald-600` wins over earlier
 * `bg-rose-600` instead of both ending up on the element.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
