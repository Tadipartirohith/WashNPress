import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// Merge conditional class lists and let later Tailwind utilities win over earlier
// ones, so a component's base classes can be overridden by a caller's `className`.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
