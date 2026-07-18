import type {
  CruxRoutingAttemptPreview,
  CruxRoutingReportPreview,
  CruxRoutingStepPreview,
  CruxRoutingTierPreview,
} from "@use-crux/core/observability";

export type RoutingReceiptStepKind =
  | "router"
  | "split"
  | "retry"
  | "fallback"
  | "cascade";

export interface RoutingAttemptView {
  model: string;
  status: string;
  durationMs?: number;
  cost?: number;
  errorCategory?: string;
  error?: string;
  delayMs?: number;
}

export interface RoutingTierView {
  index: number;
  model: string;
  status: string;
  durationMs?: number;
  cost?: number;
  judgeCost?: number;
  confidence?: number;
  budget?: number;
  note?: string;
}

export type RoutingStepView =
  | {
      kind: "router";
      id?: string;
      classifiedAs?: string;
      route?: string;
      usedDefaultRoute: boolean;
      forced: boolean;
    }
  | { kind: "split"; id?: string; route?: string; seed?: string }
  | {
      kind: "retry";
      id?: string;
      model?: string;
      attempts: RoutingAttemptView[];
    }
  | {
      kind: "fallback";
      id?: string;
      attempts: RoutingAttemptView[];
      firstTokenAt?: number;
      midStreamFailure: boolean;
    }
  | {
      kind: "cascade";
      id?: string;
      tiers: RoutingTierView[];
      acceptedAtTier?: number;
      budgetExceeded: boolean;
    };

export interface RoutingReceiptFacts {
  chosen?: string;
  classifiedAs?: string;
  tiers?: number;
  escalated?: number;
  underBudget?: boolean;
  budget?: number;
  firstTokenAt?: number;
  why?: string;
  hasDefaultRoute?: boolean;
  hasMidStreamFailure?: boolean;
}

/** True when an artifact preview carries the canonical routing receipt shape. */
export function isRoutingReportPreview(
  value: unknown,
): value is CruxRoutingReportPreview {
  if (!isRecord(value) || typeof value.model !== "string") return false;
  if (
    value.cost !== undefined &&
    value.cost !== null &&
    !isFiniteNumber(value.cost)
  )
    return false;
  if (value.firstTokenAt !== undefined && !isFiniteNumber(value.firstTokenAt))
    return false;
  return (
    Array.isArray(value.trace) &&
    value.trace.length > 0 &&
    value.trace.every(isRoutingStepPreview)
  );
}

/** Convert receipt trace data into discriminated rows for rendering and tests. */
export function routingStepViews(
  report: CruxRoutingReportPreview,
): RoutingStepView[] {
  return report.trace.flatMap((step) => routingStepView(step));
}

/** Derive compact inspector facts from the same receipt rows used by the tab UI. */
export function routingFactsFromReport(
  report: CruxRoutingReportPreview,
  attrs: Record<string, unknown> = {},
): RoutingReceiptFacts {
  const steps = routingStepViews(report);
  const router = steps.find(
    (step): step is Extract<RoutingStepView, { kind: "router" }> =>
      step.kind === "router",
  );
  const cascade = [...steps]
    .reverse()
    .find(
      (step): step is Extract<RoutingStepView, { kind: "cascade" }> =>
        step.kind === "cascade",
    );
  const fallback = steps.find(
    (step): step is Extract<RoutingStepView, { kind: "fallback" }> =>
      step.kind === "fallback",
  );
  const acceptedAt = cascade?.acceptedAtTier;
  const totalTiers = cascade?.tiers.length || numberFrom(attrs.totalTiers);
  const budgetExceeded =
    cascade?.budgetExceeded ??
    (typeof attrs.budgetExceeded === "boolean"
      ? attrs.budgetExceeded
      : undefined);

  const facts: RoutingReceiptFacts = {
    chosen: report.model,
    classifiedAs: router?.classifiedAs,
    hasDefaultRoute: router?.usedDefaultRoute,
    hasMidStreamFailure: fallback?.midStreamFailure,
    firstTokenAt: report.firstTokenAt ?? fallback?.firstTokenAt,
  };
  if (totalTiers) facts.tiers = totalTiers;
  if (acceptedAt != null) facts.escalated = acceptedAt;
  if (budgetExceeded != null) facts.underBudget = !budgetExceeded;
  const budget = numberFrom(attrs.maxCost);
  if (budget != null) facts.budget = budget;
  if (acceptedAt != null && totalTiers) {
    const notReached = Math.max(
      0,
      totalTiers - (cascade?.tiers.length ?? totalTiers),
    );
    const parts = [`accepted at tier ${acceptedAt + 1} of ${totalTiers}`];
    if (acceptedAt > 0) parts.push(`escalated ${acceptedAt}`);
    if (notReached > 0)
      parts.push(
        `${notReached} tier${notReached === 1 ? "" : "s"} not reached`,
      );
    facts.why = `${parts.join("; ")}.`;
  }
  return facts;
}

function routingStepView(step: CruxRoutingStepPreview): RoutingStepView[] {
  switch (step.kind) {
    case "router":
      return [
        {
          kind: "router",
          id: step.id,
          classifiedAs: step.classifiedAs,
          route: step.route,
          usedDefaultRoute: step.usedDefaultRoute === true,
          forced: step.forced === true,
        },
      ];
    case "split":
      return [
        { kind: "split", id: step.id, route: step.route, seed: step.seed },
      ];
    case "retry":
      return [
        {
          kind: "retry",
          id: step.id,
          model: step.model,
          attempts: attemptsFrom(step.attempts),
        },
      ];
    case "fallback":
      return [
        {
          kind: "fallback",
          id: step.id,
          attempts: attemptsFrom(step.attempts),
          firstTokenAt: step.firstTokenAt,
          midStreamFailure: step.midStreamFailure === true,
        },
      ];
    case "cascade":
      return [
        {
          kind: "cascade",
          id: step.id,
          tiers: tiersFrom(step.tiers),
          acceptedAtTier: step.acceptedAtTier,
          budgetExceeded: step.budgetExceeded === true,
        },
      ];
  }
}

function attemptsFrom(
  attempts: readonly CruxRoutingAttemptPreview[] | undefined,
): RoutingAttemptView[] {
  return (attempts ?? []).map((attempt) => ({
    model: attempt.model,
    status: attempt.status,
    durationMs: attempt.durationMs,
    cost: numberFrom(attempt.cost),
    errorCategory: attempt.errorCategory,
    error: attempt.error,
    delayMs: attempt.delayMs,
  }));
}

function tiersFrom(
  tiers: readonly CruxRoutingTierPreview[] | undefined,
): RoutingTierView[] {
  return (tiers ?? []).map((tier, index) => ({
    index: tier.tier ?? index,
    model: tier.model,
    status: tier.status ?? tier.verdict ?? "unknown",
    durationMs: tier.durationMs,
    cost: numberFrom(tier.cost),
    judgeCost: tier.judgeCost,
    confidence: tier.confidence,
    budget: tier.budget,
    note: tier.note,
  }));
}

function numberFrom(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isRoutingStepPreview(value: unknown): value is CruxRoutingStepPreview {
  if (!isRecord(value)) return false;
  return (
    value.kind === "router" ||
    value.kind === "split" ||
    value.kind === "retry" ||
    value.kind === "fallback" ||
    value.kind === "cascade"
  );
}
