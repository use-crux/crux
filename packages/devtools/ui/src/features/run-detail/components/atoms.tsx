/**
 * Run-detail presentational atoms.
 *
 * Ports the design's `v5-atoms` (KindTag · StatusPill · StatStrip · LensSwitch)
 * onto the app's `--devtools-*` theme tokens + existing `Chip`/`Icon` primitives.
 * Pure presentation — no data, no navigation, no feature coupling.
 *
 * NOTE: `KindTag` and `StatusPill` encode the observability run/span
 * vocabulary and will be reused by the Runs *list* when §8 of the redesign
 * lands. At that point they should graduate to a narrow shared module; until
 * a second consumer exists they live with their first consumer (run-detail).
 */

import * as React from "react";
import { cn } from "@/shared/lib/utils";
import { Chip, type ChipTone } from "@/devtools/shell/primitives";
import { Icon } from "@/devtools/shell/Icon";
import type { IconName } from "@/devtools/shell/nav";
import type { RunLens } from "@/features/run-detail/types";
import {
  TONE_VAR,
  primitiveTagLabel,
  primitiveTone,
} from "@/features/run-detail/lib/families";

// ─── KindTag ────────────────────────────────────────────────────────
//
// A small tinted pill for a node's semantic kind / primitive family. Keyed
// by `CruxPresentationNodeKind` and the coarser `RunKind` the list derives,
// so the same component renders both the run-row tag and the tree-row tag.

export type RunNodeKind =
  // CruxPresentationNodeKind
  | "run"
  | "agent"
  | "generation"
  | "tool"
  | "flow"
  | "step"
  | "composition"
  | "transition"
  | "memory"
  | "retrieval"
  | "detail"
  | "operation"
  // coarse list RunKind extras
  | "swarm"
  | "pipeline"
  | "consensus"
  | "generate"
  | "resolve"
  | "trace"
  | (string & {});

// Coarse fallback tones — used only when a tag is fed a `kind` with no
// `primitive` to resolve a family from. Family-aligned per the v2 design system
// (Orchestration crux · Agents iris · Generation warn · State plum · …).
const KIND_TONE: Record<string, ChipTone> = {
  run: "crux",
  flow: "crux",
  agent: "iris",
  swarm: "crux",
  consensus: "crux",
  composition: "crux",
  pipeline: "crux",
  memory: "plum",
  generation: "warn",
  generate: "warn",
  transition: "muted",
  retrieval: "ok",
  tool: "muted",
  step: "muted",
  resolve: "muted",
  defer: "crux",
  trace: "muted",
  detail: "muted",
  operation: "plum",
};

/** Short display label for a kind (kept compact for dense rows). */
function kindLabel(kind: RunNodeKind): string {
  return String(kind);
}

export function KindTag({
  kind,
  primitive,
  size = 11,
  className,
}: {
  kind: RunNodeKind;
  /** The span's full primitive string. When present the tag *names its
   *  primitive* and is coloured by its family (v2 §5/§8.3); otherwise it falls
   *  back to the coarse `kind` label + {@link KIND_TONE}. */
  primitive?: string;
  /** Font size in px (the design scales this from 9–11 across surfaces). */
  size?: number;
  className?: string;
}) {
  const tone = primitive
    ? primitiveTone(primitive)
    : (KIND_TONE[kind] ?? "muted");
  const label = primitive ? primitiveTagLabel(primitive) : kindLabel(kind);
  return (
    <Chip
      tone={tone}
      dot
      mono
      className={cn("uppercase tracking-[0.04em]", className)}
      style={{ fontSize: size, paddingTop: 1, paddingBottom: 1 }}
    >
      {label}
    </Chip>
  );
}

// ─── StatusPill ─────────────────────────────────────────────────────
//
// The full 9-state status vocabulary. Conveyed by tone + dot + label (never
// color alone, per the a11y note). `running` adds a soft pulse.

export type RunStatus =
  | "running"
  | "ok"
  | "error"
  | "blocked"
  | "cancelled"
  | "suspended"
  | "skipped"
  | "incomplete"
  | "stale"
  | (string & {});

interface StatusMeta {
  tone: ChipTone;
  label: string;
  /** Render dim + strikethrough (deliberately-not-taken paths). */
  faint?: boolean;
  pulse?: boolean;
}

const STATUS_META: Record<string, StatusMeta> = {
  running: { tone: "crux", label: "running", pulse: true },
  ok: { tone: "ok", label: "ok" },
  success: { tone: "ok", label: "ok" }, // tolerate the legacy value if it ever appears
  warn: { tone: "warn", label: "warn" },
  error: { tone: "danger", label: "error" },
  // Safety blocks read in the Safety family tone (red), matching
  // `statusTone()` in span-detail-inspection.ts — the two maps must agree.
  blocked: { tone: "danger", label: "blocked" },
  cancelled: { tone: "muted", label: "cancelled" },
  // Per the design status vocab, running & suspended both read teal (the label
  // + dot disambiguate). Matches `statusTone()` in span-detail-inspection.ts.
  suspended: { tone: "crux", label: "suspended" },
  skipped: { tone: "muted", label: "skipped", faint: true },
  incomplete: { tone: "muted", label: "incomplete" },
  stale: { tone: "warn", label: "stale" },
};

export function StatusPill({
  status,
  className,
}: {
  status: RunStatus;
  className?: string;
}) {
  const meta = STATUS_META[status] ?? {
    tone: "muted" as ChipTone,
    label: String(status),
  };
  return (
    <Chip
      tone={meta.tone}
      dot
      className={cn(
        meta.faint && "opacity-60 line-through",
        meta.pulse && "animate-pulse",
        className,
      )}
    >
      {meta.label}
    </Chip>
  );
}

// ─── StatStrip ──────────────────────────────────────────────────────
//
// The headline metric strip (duration · TTFT/TPS · tokens · cost · cache).
// Lives on the run header and the span sub-header so collapsing the inspector
// never hides the numbers.

export interface StatItem {
  label: string;
  value: React.ReactNode;
  /** Tint the value (e.g. `ok` for cache savings). */
  tone?: ChipTone;
}

export function StatStrip({
  items,
  size = 11.5,
  gap = 14,
  className,
}: {
  items: readonly StatItem[];
  size?: number;
  gap?: number;
  className?: string;
}) {
  if (items.length === 0) return null;
  return (
    <div className={cn("flex items-center", className)} style={{ gap }}>
      {items.map((it) => (
        <div key={it.label} className="flex flex-col leading-tight">
          <span
            className="font-mono uppercase tracking-[0.04em]"
            style={{ fontSize: size - 3, color: "var(--devtools-fg-faint)" }}
          >
            {it.label}
          </span>
          <span
            className="font-mono font-medium"
            style={{
              fontSize: size,
              color: it.tone ? TONE_VAR[it.tone] : "var(--devtools-fg)",
            }}
          >
            {it.value}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── LensSwitch ─────────────────────────────────────────────────────
//
// The Tree / Timeline / Graph / Story segmented control. Selection-driven;
// the lens changes how you navigate, never the data.

export type { RunLens };

export interface LensDef {
  id: RunLens;
  label: string;
  icon: IconName;
}

/** Default lens set + their icons (graph → `layers`; design wanted a
 *  dedicated branch glyph — refine the icon set in a later pass). */
export const RUN_LENSES: readonly LensDef[] = [
  { id: "tree", label: "Tree", icon: "trace" },
  { id: "timeline", label: "Timeline", icon: "clock" },
  { id: "graph", label: "Graph", icon: "layers" },
  { id: "story", label: "Story", icon: "play" },
];

export function LensSwitch({
  active,
  onSelect,
  lenses = RUN_LENSES,
  dense = false,
  className,
  summary,
}: {
  active: RunLens;
  onSelect: (lens: RunLens) => void;
  lenses?: readonly LensDef[];
  dense?: boolean;
  className?: string;
  /** Eval/indexing runs prepend a leading "Summary" segment (NOT a 5th lens,
   *  design `ArchLens`). When `summary.active`, no lens is highlighted. */
  summary?: { active: boolean; onSelect: () => void };
}) {
  return (
    <div
      role="tablist"
      aria-label="Run lens"
      className={cn(
        "inline-flex items-center rounded-[8px] p-[2px]",
        className,
      )}
      style={{
        background: "var(--devtools-bg-elev)",
        boxShadow: "inset 0 0 0 1px var(--devtools-border)",
      }}
    >
      {summary && (
        <>
          <button
            type="button"
            role="tab"
            aria-selected={summary.active}
            onClick={summary.onSelect}
            className={cn(
              "inline-flex items-center gap-[6px] rounded-[6px] font-medium transition-colors",
              dense
                ? "px-[8px] py-[4px] text-[11.5px]"
                : "px-[11px] py-[6px] text-[12.5px]",
            )}
            style={{
              background: summary.active
                ? "var(--devtools-crux-soft)"
                : "transparent",
              color: summary.active ? "var(--devtools-crux)" : "var(--devtools-fg-muted)",
              boxShadow: summary.active
                ? "inset 0 0 0 1px var(--devtools-crux-line)"
                : "none",
            }}
          >
            <Icon name="layers" size={dense ? 13 : 14} />
            Summary
          </button>
          <span
            className="mx-[3px] h-[16px] w-px shrink-0"
            style={{ background: "var(--devtools-border)" }}
          />
        </>
      )}
      {lenses.map((lens) => {
        const on = !summary?.active && lens.id === active;
        return (
          <button
            key={lens.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onSelect(lens.id)}
            className={cn(
              "inline-flex items-center gap-[6px] rounded-[6px] font-medium transition-colors",
              dense
                ? "px-[8px] py-[4px] text-[11.5px]"
                : "px-[11px] py-[6px] text-[12.5px]",
            )}
            style={{
              background: on ? "var(--devtools-crux-soft)" : "transparent",
              color: on ? "var(--devtools-crux)" : "var(--devtools-fg-muted)",
              boxShadow: on ? "inset 0 0 0 1px var(--devtools-crux-line)" : "none",
            }}
          >
            <Icon name={lens.icon} size={dense ? 13 : 14} />
            {lens.label}
          </button>
        );
      })}
    </div>
  );
}
