import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatTokens(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n < 1_000)       return n.toString();
  if (n < 1_000_000)   return (n / 1_000).toFixed(n < 10_000 ? 2 : 1) + "K";
  if (n < 1_000_000_000) return (n / 1_000_000).toFixed(n < 10_000_000 ? 2 : 1) + "M";
  return (n / 1_000_000_000).toFixed(2) + "B";
}

export function formatUSD(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n < 0.01 && n > 0) return "<$0.01";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

export function percent(part: number, whole: number): number {
  if (!whole || whole <= 0) return 0;
  return Math.min(100, Math.max(0, (part / whole) * 100));
}
