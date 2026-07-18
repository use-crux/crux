/**
 * Status registries for the `Explain` tab — the one place saturated colour
 * leads. Each registry maps a report status string to an app {@link ChipTone}
 * plus a `solid` flag (filled vs. hollow) and human label/blurb. Everything
 * else on a row (evidence level, source) stays quiet mono metadata.
 *
 * Freshness and cache are kept deliberately distinct: freshness is the loud
 * *correctness* axis (stale-used is the risk to notice), cache is the calm
 * *efficiency* axis (a hit is good news). They never share a tone family here.
 */

import type { ChipTone } from "@/devtools/shell/primitives";
import type { TurnEvidenceLevel } from "@/types";

/** Display metadata for a status chip. */
export interface StatusMeta {
  tone: ChipTone;
  /** Filled (saturated) when true; hollow outline when false. */
  solid: boolean;
  label: string;
  blurb: string;
  /** Collapse to `—` instead of rendering a chip (e.g. `not-applicable`). */
  hidden?: boolean;
}

// ── Freshness — the loud axis (clock). ──────────────────────────────────────
const FRESHNESS: Record<string, StatusMeta> = {
  fresh: {
    tone: "ok",
    solid: true,
    label: "fresh",
    blurb: "Current enough for this turn.",
  },
  refreshed: {
    tone: "crux",
    solid: true,
    label: "refreshed",
    blurb: "Recomputed before the request — deliberately made current.",
  },
  "stale-used": {
    tone: "warn",
    solid: true,
    label: "stale · used",
    blurb: "Stale, but allowed by policy. The risk to notice.",
  },
  "stale-rejected": {
    tone: "warn",
    solid: false,
    label: "stale · rejected",
    blurb: "Stale and correctly not used — explains a downstream drop.",
  },
  unknown: {
    tone: "muted",
    solid: false,
    label: "freshness unknown",
    blurb: "No freshness proof was recorded.",
  },
  "not-applicable": {
    tone: "muted",
    solid: false,
    hidden: true,
    label: "n/a",
    blurb: "Freshness does not apply.",
  },
};

export function freshnessMeta(status: string): StatusMeta {
  return FRESHNESS[status] ?? FRESHNESS.unknown;
}

/** Freshness states worth a chip on an otherwise-calm evidence row. */
export function freshnessIsNotable(status: string | undefined): boolean {
  return (
    status === "stale-used" ||
    status === "stale-rejected" ||
    status === "unknown"
  );
}

// ── Cache — the calm axis (disk), kept separate from freshness. ──────────────
const CACHE: Record<string, StatusMeta> = {
  hit: {
    tone: "crux",
    solid: true,
    label: "cache hit",
    blurb: "Reused a cached entry — saved tokens & latency.",
  },
  miss: {
    tone: "muted",
    solid: false,
    label: "cache miss",
    blurb: "Looked up, no reusable entry.",
  },
  write: {
    tone: "iris",
    solid: false,
    label: "cache write",
    blurb: "Wrote a new cache entry for next time.",
  },
  disabled: {
    tone: "muted",
    solid: false,
    label: "cache off",
    blurb: "Caching was disabled.",
  },
  mixed: {
    tone: "muted",
    solid: false,
    label: "cache mixed",
    blurb: "Several cache states were involved.",
  },
  unknown: {
    tone: "muted",
    solid: false,
    label: "cache unknown",
    blurb: "Cache behaviour was not recorded.",
  },
  "not-applicable": {
    tone: "muted",
    solid: false,
    hidden: true,
    label: "n/a",
    blurb: "Cache does not apply.",
  },
};

export function cacheMeta(status: string): StatusMeta {
  return CACHE[status] ?? CACHE.unknown;
}

// ── Coverage — the protect scorecard. A nudge, never severity. ───────────────
const COVERAGE: Record<string, StatusMeta> = {
  covered: {
    tone: "ok",
    solid: true,
    label: "covered",
    blurb: "An Eval asserts this behaviour.",
  },
  partial: {
    tone: "warn",
    solid: true,
    label: "partially covered",
    blurb: "Some of this behaviour is asserted; gaps remain.",
  },
  none: {
    tone: "warn",
    solid: false,
    label: "not covered",
    blurb: "No Eval asserts this. A gap worth testing.",
  },
  unknown: {
    tone: "muted",
    solid: false,
    label: "coverage unknown",
    blurb: "Coverage could not be determined.",
  },
};

export function coverageMeta(status: string): StatusMeta {
  return COVERAGE[status] ?? COVERAGE.unknown;
}

// ── Source join status — quiet, neutral. ─────────────────────────────────────
const SOURCE_STATUS: Record<string, { tone: ChipTone; label: string }> = {
  used: { tone: "ok", label: "used" },
  checked: { tone: "warn", label: "checked" },
  dropped: { tone: "danger", label: "dropped" },
  "decision-only": { tone: "muted", label: "decision" },
  unresolved: { tone: "muted", label: "unresolved" },
  unknown: { tone: "muted", label: "unknown" },
};

export function sourceStatusMeta(status: string): {
  tone: ChipTone;
  label: string;
} {
  return SOURCE_STATUS[status] ?? SOURCE_STATUS.unresolved;
}

/** Human blurb for a source fidelity value (why the join is as confident as it is). */
export const SOURCE_FIDELITY_BLURB: Record<string, string> = {
  exact: "resolved to the exact call site",
  "runtime-join": "joined via runtime correlation",
  "source-id": "matched by stable id only",
  inferred: "inferred — not directly resolved",
  unresolved: "no source definition resolved",
};

// ── Evidence ladder — the honesty layer (neutral, not severity). ─────────────
const EVIDENCE_RANK: Record<TurnEvidenceLevel, number> = {
  declared: 4,
  observed: 3,
  inferred: 2,
  missing: 1,
};

export function evidenceRank(level: TurnEvidenceLevel): number {
  return EVIDENCE_RANK[level] ?? 1;
}

/** Degraded levels render inline (by exception); proven levels stay calm. */
export function evidenceIsDegraded(
  level: TurnEvidenceLevel | undefined,
): boolean {
  return level === "inferred" || level === "missing";
}
