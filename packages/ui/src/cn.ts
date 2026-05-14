import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Combine class names with conflict-resolving Tailwind merge. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
