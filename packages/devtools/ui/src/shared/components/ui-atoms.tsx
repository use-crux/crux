/**
 * Shared UI atoms used across devtools views.
 */
import type { ReactNode } from "react";

export function fmt(
  n: number | null | undefined,
  type: "tok" | "$" | "ms",
): string {
  if (n == null) return "-";
  switch (type) {
    case "tok":
      if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
      if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
      return String(n);
    case "$":
      if (n >= 1) return `$${n.toFixed(2)}`;
      if (n >= 0.01) return `$${n.toFixed(3)}`;
      return `$${n.toFixed(4)}`;
    case "ms":
      if (n >= 60_000) return `${(n / 60_000).toFixed(1)}m`;
      return `${(n / 1000).toFixed(1)}s`;
  }
}

export function Metric({
  label,
  value,
  color = "text-(--qw-fg)",
  sub,
}: {
  label: string;
  value: string;
  color?: string;
  sub?: string;
}) {
  return (
    <div>
      <div className="text-[11px] text-(--qw-fg-faint) leading-tight">
        {label}
      </div>
      <div
        className={`mt-1 text-sm font-medium tabular-nums leading-tight ${color}`}
      >
        {value}
        {sub && (
          <span className="ml-1 text-[11px] font-normal text-(--qw-fg-faint)">
            {sub}
          </span>
        )}
      </div>
    </div>
  );
}

export function Pill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center border border-(--qw-border) bg-(--qw-bg-elev) px-1.5 py-0.5 text-[11px] tabular-nums text-(--qw-fg-muted)">
      {children}
    </span>
  );
}

export function SectionHead({ children }: { children: ReactNode }) {
  return (
    <h4 className="mb-3 text-sm font-medium text-(--qw-fg)">{children}</h4>
  );
}

export function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="border border-(--qw-border) bg-(--qw-bg-elev) p-4">
      <div className="text-sm text-(--qw-fg-faint)">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-(--qw-fg)">
        {value}
      </div>
      {sub && <div className="mt-1 text-xs text-(--qw-fg-faint)">{sub}</div>}
    </div>
  );
}

export function TabBar({
  tabs,
  active,
  onChange,
}: {
  tabs: string[];
  active: string;
  onChange: (tab: string) => void;
}) {
  return (
    <div className="mb-4 flex gap-1 border-b border-(--qw-border)">
      {tabs.map((tab) => (
        <button
          key={tab}
          onClick={() => onChange(tab)}
          className={`px-3 py-2 text-sm border-b-2 transition-colors ${
            active === tab
              ? "border-(--qw-fg-muted) text-(--qw-fg)"
              : "border-transparent text-(--qw-fg-faint) hover:text-(--qw-fg-muted)"
          }`}
        >
          {tab}
        </button>
      ))}
    </div>
  );
}

export function ChevronToggle({
  open,
  className,
}: {
  open: boolean;
  className?: string;
}) {
  return (
    <svg
      className={`w-3.5 h-3.5 text-(--qw-fg-faint) transition-transform ${open ? "rotate-180" : ""} ${className ?? ""}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M19 9l-7 7-7-7"
      />
    </svg>
  );
}

/** Score on 0–1 scale → color class */
export function scoreColor(score: number): string {
  if (score >= 0.7) return "text-(--qw-ok)";
  if (score >= 0.5) return "text-(--qw-warn)";
  return "text-(--qw-danger)";
}

/** Score on 0–1 scale → bg class */
export function scoreBg(score: number): string {
  if (score >= 0.7) return "bg-(--qw-ok)";
  if (score >= 0.5) return "bg-(--qw-warn)";
  return "bg-(--qw-danger)";
}

/** Score on 0–1 scale → hex color (for SVG fill) */
export function scoreHex(score: number): string {
  if (score >= 0.7) return "#34d399";
  if (score >= 0.5) return "#fbbf24";
  return "#f87171";
}

/** Agreement percentage → color class */
export function agreementColor(pct: number): string {
  if (pct >= 80) return "text-(--qw-ok)";
  if (pct >= 50) return "text-(--qw-warn)";
  return "text-(--qw-danger)";
}

/** Pass rate (0–1) → color class */
export function passRateColor(rate: number): string {
  if (rate === 1) return "text-(--qw-ok)";
  if (rate >= 0.5) return "text-(--qw-warn)";
  return "text-(--qw-danger)";
}

/** Pass rate (0–1) → bg class */
export function passRateBg(rate: number): string {
  if (rate === 1) return "bg-(--qw-ok)";
  if (rate >= 0.5) return "bg-(--qw-warn)";
  return "bg-(--qw-danger)";
}
