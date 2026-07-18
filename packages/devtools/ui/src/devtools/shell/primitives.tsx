/**
 * Devtools shared primitives.
 *
 * Editorial style with crux teal accent. All components use CSS vars
 * declared in index.css (--devtools-*), so they respond to the global light/dark
 * theme toggle automatically.
 */

import * as React from "react";
import { cn } from "@/shared/lib/utils";

// ─── Sparkline ──────────────────────────────────────────────────────

interface SparklineProps {
  data: readonly number[];
  width?: number;
  height?: number;
  color?: string;
  fill?: boolean;
  className?: string;
}

export function Sparkline({
  data,
  width = 80,
  height = 22,
  color,
  fill = true,
  className,
}: SparklineProps) {
  if (!data.length)
    return <svg width={width} height={height} className={className} />;
  const stroke = color ?? "var(--devtools-crux)";
  const max = Math.max(...data);
  const min = Math.min(...data);
  const constantNonZero = max === min && max > 0;
  const visualMin = constantNonZero ? 0 : min;
  const visualMax = constantNonZero ? max : max;
  const range = visualMax - visualMin || 1;
  const step = data.length > 1 ? width / (data.length - 1) : 0;
  const pts = data.map(
    (v, i) => [i * step, height - ((v - visualMin) / range) * height] as const,
  );
  const path = pts
    .map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`)
    .join(" ");
  const area = `${path} L${width},${height} L0,${height} Z`;
  return (
    <svg
      width={width}
      height={height}
      className={cn("block", className)}
      aria-hidden
    >
      {fill && <path d={area} fill={stroke} opacity={0.12} />}
      <path
        d={path}
        fill="none"
        stroke={stroke}
        strokeWidth={1.4}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ─── Chip ───────────────────────────────────────────────────────────

export type ChipTone =
  | "muted"
  | "crux"
  | "danger"
  | "warn"
  | "ok"
  | "iris"
  | "gold"
  | "plum";

interface ChipProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: ChipTone;
  dot?: boolean;
  mono?: boolean;
  children: React.ReactNode;
}

const CHIP_TONE: Record<
  ChipTone,
  { bg: string; fg: string; ring: string; dot: string }
> = {
  muted: {
    bg: "var(--devtools-bg-muted)",
    fg: "var(--devtools-fg-muted)",
    ring: "var(--devtools-border)",
    dot: "var(--devtools-fg-muted)",
  },
  crux: {
    bg: "var(--devtools-crux-soft)",
    fg: "var(--devtools-crux)",
    ring: "var(--devtools-crux-line)",
    dot: "var(--devtools-crux)",
  },
  danger: {
    bg: "var(--devtools-danger-soft)",
    fg: "var(--devtools-danger)",
    ring: "var(--devtools-danger-soft)",
    dot: "var(--devtools-danger)",
  },
  warn: {
    bg: "var(--devtools-warn-soft)",
    fg: "var(--devtools-warn)",
    ring: "var(--devtools-warn-soft)",
    dot: "var(--devtools-warn)",
  },
  ok: {
    bg: "var(--devtools-ok-soft)",
    fg: "var(--devtools-ok)",
    ring: "var(--devtools-ok-soft)",
    dot: "var(--devtools-ok)",
  },
  iris: {
    bg: "var(--devtools-iris-soft)",
    fg: "var(--devtools-iris)",
    ring: "var(--devtools-iris-soft)",
    dot: "var(--devtools-iris)",
  },
  gold: {
    bg: "var(--devtools-gold-soft)",
    fg: "var(--devtools-gold)",
    ring: "var(--devtools-gold-line)",
    dot: "var(--devtools-gold)",
  },
  plum: {
    bg: "var(--devtools-plum-soft)",
    fg: "var(--devtools-plum)",
    ring: "var(--devtools-plum-line)",
    dot: "var(--devtools-plum)",
  },
};

export function Chip({
  tone = "muted",
  dot = false,
  mono = false,
  className,
  children,
  style,
  ...rest
}: ChipProps) {
  const c = CHIP_TONE[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-[5px] rounded-[4px] px-[7px] py-[2px] text-[11px] font-medium leading-[1.4] whitespace-nowrap",
        mono && "font-mono",
        className,
      )}
      style={{
        background: c.bg,
        color: c.fg,
        boxShadow: `inset 0 0 0 1px ${c.ring}`,
        ...style,
      }}
      {...rest}
    >
      {dot && (
        <span
          className="inline-block size-[5px] rounded-full"
          style={{ background: c.dot }}
        />
      )}
      {children}
    </span>
  );
}

// ─── Button ─────────────────────────────────────────────────────────

export type BtnVariant = "primary" | "soft" | "ghost" | "outline" | "danger";
export type BtnSize = "xs" | "sm" | "md";

export interface BtnProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: BtnVariant;
  size?: BtnSize;
  icon?: React.ReactNode;
  iconRight?: React.ReactNode;
}

const BTN_VARIANT: Record<
  BtnVariant,
  { bg: string; fg: string; ring: string }
> = {
  primary: {
    bg: "var(--devtools-crux)",
    fg: "var(--devtools-bg)",
    ring: "var(--devtools-crux)",
  },
  soft: {
    bg: "var(--devtools-crux-soft)",
    fg: "var(--devtools-crux)",
    ring: "var(--devtools-crux-line)",
  },
  ghost: {
    bg: "transparent",
    fg: "var(--devtools-fg)",
    ring: "var(--devtools-border)",
  },
  outline: {
    bg: "var(--devtools-bg-elev)",
    fg: "var(--devtools-fg)",
    ring: "var(--devtools-border)",
  },
  danger: {
    bg: "var(--devtools-danger-soft)",
    fg: "var(--devtools-danger)",
    ring: "var(--devtools-danger-soft)",
  },
};

const BTN_SIZE: Record<BtnSize, string> = {
  xs: "text-[11px] py-[4px] px-[8px] gap-[5px]",
  sm: "text-[12px] py-[6px] px-[10px] gap-[6px]",
  md: "text-[13px] py-[8px] px-[14px] gap-[7px]",
};

export function Btn({
  variant = "ghost",
  size = "sm",
  icon,
  iconRight,
  className,
  style,
  children,
  ...rest
}: BtnProps) {
  const v = BTN_VARIANT[variant];
  return (
    <button
      type="button"
      className={cn(
        "inline-flex items-center rounded-[6px] font-medium whitespace-nowrap transition-colors hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed",
        BTN_SIZE[size],
        className,
      )}
      style={{
        background: v.bg,
        color: v.fg,
        boxShadow: `inset 0 0 0 1px ${v.ring}`,
        ...style,
      }}
      {...rest}
    >
      {icon}
      {children}
      {iconRight}
    </button>
  );
}

// ─── Eyebrow ────────────────────────────────────────────────────────

export function Eyebrow({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "m-0 text-[10.5px] font-medium tracking-[0.2em] uppercase",
        className,
      )}
      style={{ color: "var(--devtools-crux)" }}
    >
      {children}
    </p>
  );
}

// ─── SectionHead ────────────────────────────────────────────────────

export function SectionHead({
  eyebrow,
  right,
  className,
}: {
  eyebrow: React.ReactNode;
  right?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-3 flex items-center gap-3", className)}>
      <Eyebrow>{eyebrow}</Eyebrow>
      <div
        className="h-px flex-1"
        style={{ background: "var(--devtools-border)" }}
      />
      {right}
    </div>
  );
}

// ─── KPI tile ───────────────────────────────────────────────────────

export function Kpi({
  label,
  value,
  delta,
  trend,
  sublabel,
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  delta?: string;
  trend?: readonly number[];
  sublabel?: React.ReactNode;
  className?: string;
}) {
  const deltaColor =
    delta == null
      ? undefined
      : delta.startsWith("-")
        ? "var(--devtools-danger)"
        : delta.startsWith("+")
          ? "var(--devtools-ok)"
          : "var(--devtools-fg-muted)";
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-1.5 rounded-[10px] px-4 py-[14px]",
        className,
      )}
      style={{
        background: "var(--devtools-bg-elev)",
        border: "1px solid var(--devtools-border)",
      }}
    >
      <div className="flex items-center justify-between">
        <span
          className="text-[11px] font-medium uppercase tracking-[0.04em]"
          style={{ color: "var(--devtools-fg-muted)" }}
        >
          {label}
        </span>
        {trend && <Sparkline data={trend} width={50} height={16} />}
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-[24px] font-semibold tracking-[-0.02em]">
          {value}
        </span>
        {delta && (
          <span
            className="font-mono text-[11px] font-medium"
            style={{ color: deltaColor }}
          >
            {delta}
          </span>
        )}
      </div>
      {sublabel && (
        <span
          className="text-[11px]"
          style={{ color: "var(--devtools-fg-faint)" }}
        >
          {sublabel}
        </span>
      )}
    </div>
  );
}

// ─── ScoreBar ───────────────────────────────────────────────────────

export function ScoreBar({
  score,
  color,
  max = 1,
  className,
  threshold,
}: {
  score: number;
  color?: string;
  max?: number;
  className?: string;
  threshold?: number;
}) {
  const pct = Math.min(100, Math.max(0, (score / max) * 100));
  return (
    <div
      className={cn(
        "relative h-1.5 flex-1 overflow-hidden rounded-full",
        className,
      )}
      style={{ background: "var(--devtools-bg-muted)" }}
    >
      <div
        className="h-full rounded-full"
        style={{
          width: `${pct}%`,
          background: color ?? "var(--devtools-crux)",
        }}
      />
      {threshold != null && (
        <div
          className="absolute -top-0.5 -bottom-0.5 w-px"
          style={{
            left: `${(threshold / max) * 100}%`,
            background: "var(--devtools-crux)",
          }}
        />
      )}
    </div>
  );
}

// ─── HeatCell ───────────────────────────────────────────────────────

export type HeatStatus = "pass" | "fail" | "partial" | string;

export function HeatCell({
  status,
  score,
  size = "sm",
}: {
  status: HeatStatus;
  score: number;
  size?: "sm" | "lg";
}) {
  let bg = "var(--devtools-warn-soft)";
  let fg = "var(--devtools-warn)";
  if (status === "fail") {
    bg = "var(--devtools-danger-soft)";
    fg = "var(--devtools-danger)";
  } else if (status === "partial") {
    bg = "var(--devtools-warn-soft)";
    fg = "var(--devtools-warn)";
  } else if (score >= 0.9) {
    bg = "var(--devtools-ok-soft)";
    fg = "var(--devtools-ok)";
  } else if (score >= 0.75) {
    bg = "var(--devtools-crux-soft)";
    fg = "var(--devtools-crux)";
  }
  const sym = status === "pass" ? "●" : status === "fail" ? "✕" : "◐";
  if (size === "lg") {
    return (
      <div
        className="flex items-center gap-2 rounded-[6px] px-2.5 py-1.5 font-mono text-[12.5px] font-semibold"
        style={{ background: bg, color: fg }}
      >
        <span>{sym}</span>
        <span>{score.toFixed(2)}</span>
      </div>
    );
  }
  return (
    <div
      className="inline-flex min-w-[62px] items-center justify-between gap-1.5 rounded-[4px] px-1.5 py-0.5 font-mono text-[11.5px] font-semibold"
      style={{ background: bg, color: fg }}
    >
      <span>{sym}</span>
      <span>{score.toFixed(2)}</span>
    </div>
  );
}

// ─── ScoreBadge ─────────────────────────────────────────────────────

export function ScoreBadge({
  score,
  className,
}: {
  score: number;
  className?: string;
}) {
  const tone =
    score >= 0.85
      ? "ok"
      : score >= 0.7
        ? "crux"
        : score >= 0.55
          ? "warn"
          : "danger";
  const colors = {
    ok: { bg: "var(--devtools-ok-soft)", fg: "var(--devtools-ok)" },
    crux: { bg: "var(--devtools-crux-soft)", fg: "var(--devtools-crux)" },
    warn: { bg: "var(--devtools-warn-soft)", fg: "var(--devtools-warn)" },
    danger: { bg: "var(--devtools-danger-soft)", fg: "var(--devtools-danger)" },
  }[tone];
  return (
    <span
      className={cn(
        "inline-block min-w-[42px] rounded-[3px] px-1.5 py-0.5 text-right font-mono text-[11.5px] font-semibold",
        className,
      )}
      style={{ background: colors.bg, color: colors.fg }}
    >
      {score.toFixed(2)}
    </span>
  );
}

// ─── PageGrid background ────────────────────────────────────────────

export function PageGrid({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn("min-h-full", className)}
      style={{
        backgroundImage:
          "linear-gradient(to right, var(--devtools-grid) 1px, transparent 1px), linear-gradient(to bottom, var(--devtools-grid) 1px, transparent 1px)",
        backgroundSize: "48px 48px",
      }}
    >
      {children}
    </div>
  );
}

// ─── CruxMark (sidebar wordmark) ────────────────────────────────────

export function CruxMark({ size = 18 }: { size?: number }) {
  return (
    <div className="flex items-center gap-2">
      <svg
        className="flex-none"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden
      >
        <path
          d="M12 2L2 7v10l10 5 10-5V7L12 2z"
          stroke="var(--devtools-crux)"
          strokeWidth={1.6}
          strokeLinejoin="round"
        />
        <path
          d="M12 22V12"
          stroke="var(--devtools-crux)"
          strokeWidth={1.6}
          strokeLinecap="round"
        />
        <path
          d="M2 7l10 5 10-5"
          stroke="var(--devtools-crux)"
          strokeWidth={1.6}
          strokeLinejoin="round"
        />
      </svg>
      <span
        className="font-semibold tracking-[-0.01em]"
        style={{ fontSize: size * 0.85 }}
      >
        Crux
      </span>
      <span
        style={{ fontSize: size * 0.65, color: "var(--devtools-fg-faint)" }}
      >
        devtools
      </span>
    </div>
  );
}
