import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Merges class lists and resolves conflicting Tailwind utilities. Every shadcn
 *  component imports this; the CLI expects it at exactly this path. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
