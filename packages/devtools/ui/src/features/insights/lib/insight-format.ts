import type { ChipTone } from "@/devtools/shell/primitives";

export type InsightSeverity = "high" | "medium" | "low";

export const SEV_TONE: Record<InsightSeverity, ChipTone> = {
  high: "danger",
  medium: "warn",
  low: "iris",
};

export const SEV_LABEL: Record<InsightSeverity, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

export function timeAgo(iso: string | undefined): string {
  if (!iso) return "";
  const ts = Date.parse(iso);
  if (!ts) return "";
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
