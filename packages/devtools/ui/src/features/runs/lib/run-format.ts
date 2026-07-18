import type { ChipTone } from "@/devtools/shell/primitives";
import type { RunKind, RunRow } from "../types";
export {
  deliveryHealthTone,
  explainRunReliability,
  reliabilityParts,
  reliabilityTone,
  type ReliabilitySignals,
} from "@/shared/lib/run-reliability";

// Runtime-plane family→tone, mirroring the canonical registry in
// run-detail/components/atoms.tsx (KIND_TONE) and the design system §3:
// Orchestration composites (flow · swarm · pipeline · consensus) wear the brand
// (crux) on the runtime plane; agents step back to iris.
export const KIND_TONE: Record<RunKind, ChipTone> = {
  flow: "crux",
  swarm: "crux",
  pipeline: "crux",
  consensus: "crux",
  agent: "iris",
  retrieval: "ok",
  generate: "warn",
  resolve: "muted",
  defer: "crux",
  trace: "muted",
};

export const KIND_DOT_COLOR: Record<RunKind, string> = {
  flow: "var(--devtools-crux)",
  swarm: "var(--devtools-crux)",
  pipeline: "var(--devtools-crux)",
  consensus: "var(--devtools-crux)",
  agent: "var(--devtools-iris)",
  retrieval: "var(--devtools-ok)",
  generate: "var(--devtools-warn)",
  resolve: "var(--devtools-fg-muted)",
  defer: "var(--devtools-crux)",
  trace: "var(--devtools-fg-muted)",
};

/**
 * Full 9-state run/span status vocabulary → chip tone, mirroring the design's
 * canonical `STATUS_TONE` (see `.design-ref/project/v5-atoms.jsx`). The backend
 * now emits canonical `ok` (not `success`); legacy aliases are kept so older
 * records still render. Unknown statuses fall back to `muted`, like the design.
 */
const STATUS_TONE: Record<string, ChipTone> = {
  running: "crux",
  ok: "ok",
  success: "ok", // legacy alias
  warn: "warn",
  error: "danger",
  fail: "danger", // legacy alias
  failed: "danger", // legacy alias
  blocked: "danger", // guardrail/constraint stop — Safety family (danger), per canonical STATUS_META
  cancelled: "muted",
  suspended: "crux", // durable flow paused on signal/event/timer/child
  skipped: "muted",
  incomplete: "muted", // telemetry gap (start without end) — shown honestly, not as a warning
  conflicted: "danger", // immutable identity or incompatible terminal evidence — needs attention
  stale: "warn", // live run stopped emitting records
};

export function statusTone(status: string): ChipTone {
  return STATUS_TONE[status] ?? "muted";
}

/** A run is "live" (warrants the pulsing indicator) only while running. */
export function isLiveStatus(status: string): boolean {
  return status === "running";
}

/**
 * A run only warrants the reliability badge cluster (segments/order/health)
 * when something is non-trivial — normal single-segment runs stay visually
 * calm (binding spec 04 §5).
 */
export function hasReliabilityDetail(run: RunRow): boolean {
  return (
    (run.segmentCount ?? 1) > 1 ||
    (run.gapCount ?? 0) > 0 ||
    Boolean(run.traceAliasConflict) ||
    run.orderingConfidence === "partial" ||
    run.deliveryHealth === "degraded"
  );
}

export function formatLatency(ms: number | undefined): string {
  if (ms == null) return "-";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function formatCost(n: number | undefined): string {
  if (n == null) return "-";
  if (n < 0.001) return `$${n.toFixed(6)}`;
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(3)}`;
}

/** Format server-owned graph count rollups for the dense runs table. */
export function formatGraphCounts(run: RunRow): string {
  if (
    run.spanCount == null &&
    run.eventCount == null &&
    run.artifactCount == null &&
    run.edgeCount == null &&
    run.childCount == null
  ) {
    return "-";
  }
  const spanCount = run.spanCount ?? run.childCount ?? 0;
  return [
    spanCount,
    run.eventCount ?? 0,
    run.artifactCount ?? 0,
    run.edgeCount ?? 0,
  ]
    .map((n) => n.toLocaleString())
    .join(" / ");
}

/** Human-readable tooltip for the dense graph-count column. */
export function graphCountsTitle(run: RunRow): string {
  return [
    countPart(run.recordCount, "record"),
    countPart(run.spanCount ?? run.childCount, "span"),
    countPart(run.eventCount, "event"),
    countPart(run.artifactCount, "artifact"),
    countPart(run.edgeCount, "edge"),
  ]
    .filter((part): part is string => part != null)
    .join(" · ");
}

function countPart(
  value: number | undefined,
  label: string,
): string | undefined {
  if (value == null) return undefined;
  return `${value.toLocaleString()} ${label}${value === 1 ? "" : "s"}`;
}
