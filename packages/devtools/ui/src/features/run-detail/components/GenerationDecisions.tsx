/**
 * Generation **Routing** tab — surfaces the routing / governance spans the backend
 * *folds* onto a generation (contract: `canonicalParentSpanId` points the
 * router/cascade/constraint/guardrail/security at the generation it decided for, so
 * they arrive in `node.details[]` rather than as standalone tree rows).
 *
 * Nothing else in the UI reads `node.details[]`, so without this tab the folded
 * decision evidence ("why this model / which tier / what budget") is dropped on the
 * floor even though the backend emits it correctly.
 *
 * Built to the design's `v12-cards-more` `CardRouting` (escalating tiers + fallback),
 * folded into a generation tab per the chosen UX (option 1): the screen *body* lives
 * here; the screen's *inspector* facts (`routingFacts`) fold into the generation's
 * Inspector rail (`SpanInspector`). The kind is labelled **routing**, not the
 * artboard's "generation".
 *
 * Data source: the canonical typed **`routing.report`** artifact
 * (`CruxRoutingReportPreview`) the backend emits on the `cascade.resolve` /
 * `router.resolve` span — NOT a hand-rolled attribute reconstruction (that double-
 * rendered alongside this). The carrying span's `attributes` supply only the facts
 * the report omits (totalTiers · budget · acceptedAtTier · budgetExceeded).
 */

import type {
  CruxCacheReportPreview,
  CruxCompactionReportPreview,
  CruxConstraintReportPreview,
  CruxGuardrailReportPreview,
  CruxRoutingReportPreview,
  CruxRunDetailDetail,
  CruxSecurityReportPreview,
} from "@use-crux/core/observability";
import type { ObservabilityRunDetailNode } from "@/types";
import { OperationReportFor } from "./PrimitiveCards";
import { RoutingReceiptReport } from "./RoutingReceiptReport";
import { EmptyHint } from "./SpanDetailPanelAtoms";
import {
  findArtifact,
  fmtCost,
  fmtTokens,
} from "../lib/span-detail-inspection";
import {
  isRoutingReportPreview,
  routingFactsFromReport,
} from "../lib/routing-receipt";

// Governance presence + per-type tabs live further down (`presentGovernance`,
// `GovernanceTab`, `governanceFacts`). Routing keeps its dedicated path.

// ─── typed accessors (no `any`; narrow `unknown`) ────────────────────

function attrsOf(d: CruxRunDetailDetail): Record<string, unknown> {
  return (d.attributes ?? {}) as Record<string, unknown>;
}
/** A folded routing decision: the typed report + the carrying span's facts. */
interface FoldedRouting {
  report: CruxRoutingReportPreview;
  /** `cascade.resolve` / `router.resolve` attributes — for facts the report omits. */
  attrs: Record<string, unknown>;
  status: string;
}

function foldedRoutingReports(
  node: ObservabilityRunDetailNode,
): FoldedRouting[] {
  const out: FoldedRouting[] = [];
  for (const d of node.details ?? []) {
    for (const a of d.artifacts ?? []) {
      if (a.kind === "routing.report" && isRoutingReportPreview(a.preview)) {
        out.push({ report: a.preview, attrs: attrsOf(d), status: d.status });
      }
    }
  }
  return out;
}

// ─── routing facts (folded into the generation Inspector — design InspectorPanel) ──

export interface RoutingFacts {
  chosen?: string;
  classifiedAs?: string;
  tiers?: number;
  escalated?: number;
  underBudget?: boolean;
  budget?: number;
  why?: string;
}

/** Extract the routing decision facts for the generation's Inspector rail. */
export function routingFacts(
  node: ObservabilityRunDetailNode,
): RoutingFacts | null {
  const routings = foldedRoutingReports(node);
  if (routings.length === 0) return null;
  const { report, attrs } = routings[0];
  return routingFactsFromReport(report, attrs);
}

function RoutingReportCard({ folded }: { folded: FoldedRouting }) {
  return <RoutingReceiptReport report={folded.report} attrs={folded.attrs} />;
}

// ─── tab body ────────────────────────────────────────────────────────

// ─── per-type governance tabs (each its own tab, like Routing) ──────────

export type GovType =
  | "routing"
  | "guardrail"
  | "security"
  | "constraint"
  | "cache"
  | "compaction";

const GOV_REPORT_KIND: Record<GovType, string> = {
  routing: "routing.report",
  guardrail: "guardrail.report",
  security: "security.report",
  constraint: "constraint.report",
  cache: "cache.report",
  compaction: "compaction.report",
};
export const GOV_LABEL: Record<GovType, string> = {
  routing: "Routing",
  guardrail: "Guardrail",
  security: "Security",
  constraint: "Constraint",
  cache: "Cache",
  compaction: "Compaction",
};
const GOV_ORDER: readonly GovType[] = [
  "routing",
  "guardrail",
  "security",
  "constraint",
  "cache",
  "compaction",
];

/** Which governance types are folded onto this span — one tab each. */
export function presentGovernance(node: ObservabilityRunDetailNode): GovType[] {
  return GOV_ORDER.filter(
    (t) => findArtifact(node, GOV_REPORT_KIND[t]) !== null,
  );
}

/** Center body for a governance tab. Routing keeps its rich cascade card (it
 *  carries the resolving span's attrs); the rest use the canonical report cards. */
export function GovernanceTab({
  node,
  type,
}: {
  node: ObservabilityRunDetailNode;
  type: GovType;
}) {
  if (type === "routing") {
    const routings = foldedRoutingReports(node);
    if (routings.length === 0)
      return (
        <EmptyHint>No routing decision folded onto this generation.</EmptyHint>
      );
    return (
      <div className="flex flex-col gap-5">
        {routings.map((folded, i) => (
          <RoutingReportCard key={i} folded={folded} />
        ))}
      </div>
    );
  }
  return <OperationReportFor node={node} kind={GOV_REPORT_KIND[type]} />;
}

// ─── inspector facts per governance screen (folded into the span's rail) ──

function reportPreview<T>(
  node: ObservabilityRunDetailNode,
  kind: string,
): T | undefined {
  const p = findArtifact(node, kind)?.preview;
  return typeof p === "object" &&
    p !== null &&
    (p as { kind?: unknown }).kind === kind
    ? (p as T)
    : undefined;
}

export interface GovFacts {
  type: GovType;
  label: string;
  rows: [string, string, string?][];
  note?: string;
}

/** The governance screens' `InspectorPanel` facts, to fold into the span's
 *  Inspector rail (routing has its own dedicated fold via `routingFacts`). */
export function governanceFacts(node: ObservabilityRunDetailNode): GovFacts[] {
  const out: GovFacts[] = [];

  const cache = reportPreview<CruxCacheReportPreview>(node, "cache.report");
  if (cache) {
    const rows: [string, string, string?][] = [
      [
        "result",
        String(cache.status ?? "—"),
        cache.status === "hit" ? "var(--qw-ok)" : undefined,
      ],
    ];
    if (cache.saved?.tokens != null)
      rows.push(["saved tok", fmtTokens(cache.saved.tokens)]);
    if (cache.saved?.costUsd != null)
      rows.push(["saved", fmtCost(cache.saved.costUsd)]);
    if (cache.saved?.latencyMs != null)
      rows.push(["saved ms", String(Math.round(cache.saved.latencyMs))]);
    out.push({ type: "cache", label: "Cache", rows });
  }

  const g = reportPreview<CruxGuardrailReportPreview>(node, "guardrail.report");
  if (g) {
    const rows: [string, string, string?][] = [];
    if (g.phase) rows.push(["phase", g.phase]);
    if (g.action)
      rows.push([
        "action",
        g.action,
        g.action === "block"
          ? "var(--qw-danger)"
          : g.action === "pass"
            ? "var(--qw-ok)"
            : "var(--qw-warn)",
      ]);
    if (g.matches?.length) rows.push(["matches", String(g.matches.length)]);
    out.push({ type: "guardrail", label: "Guardrail", rows, note: g.reason });
  }

  const s = reportPreview<CruxSecurityReportPreview>(node, "security.report");
  if (s) {
    const rows: [string, string, string?][] = [];
    if (s.pattern) rows.push(["type", s.pattern]);
    if (s.severity)
      rows.push([
        "severity",
        s.severity,
        s.severity === "error" ? "var(--qw-danger)" : "var(--qw-warn)",
      ]);
    if (s.action) rows.push(["action", s.action, "var(--qw-warn)"]);
    out.push({ type: "security", label: "Security", rows, note: s.message });
  }

  const c = reportPreview<CruxConstraintReportPreview>(
    node,
    "constraint.report",
  );
  if (c) {
    const attempts = c.attempts ?? [];
    const rows: [string, string, string?][] = [
      ["attempts", String(attempts.length)],
    ];
    if (c.pass != null)
      rows.push([
        "passed",
        c.pass ? "yes" : "no",
        c.pass ? "var(--qw-ok)" : "var(--qw-warn)",
      ]);
    if (attempts.length > 1)
      rows.push(["retries", String(attempts.length - 1)]);
    out.push({
      type: "constraint",
      label: "Constraint",
      rows,
      note: c.assertion ?? c.constraint,
    });
  }

  const cp = reportPreview<CruxCompactionReportPreview>(
    node,
    "compaction.report",
  );
  if (cp) {
    const before = cp.beforeTokens;
    const after = cp.afterTokens;
    const pct =
      cp.compressionRatio != null
        ? Math.round(cp.compressionRatio * 100)
        : before && after != null
          ? Math.round((1 - after / before) * 100)
          : undefined;
    const rows: [string, string, string?][] = [];
    if (before != null) rows.push(["before", fmtTokens(before)]);
    if (after != null) rows.push(["after", fmtTokens(after)]);
    if (pct != null) rows.push(["saved", `${pct}%`, "var(--qw-ok)"]);
    out.push({ type: "compaction", label: "Compaction", rows });
  }

  return out;
}
