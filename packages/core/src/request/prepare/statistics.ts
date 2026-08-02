/** Process-local preparation statistics for one immediate language activation. @internal */

import {
  createMemoryStatisticsLedger,
  type ScopeStats,
  type StatisticsLedger,
  type StatisticsOwner,
  type StatisticsUsageReport,
} from "../../statistics";
import type {
  PreparationScopeStats,
  StepPreparationStats,
  StepReason,
} from "./step-context";

let nextRunId = 0;

/** Private statistics recorder consumed by immediate `prepareStep` execution. @internal */
export interface PreparationStatistics {
  /** Snapshot committed facts before one semantic boundary. */
  beforeStep(input: {
    readonly stepIndex: number;
    readonly reason: StepReason;
  }): StepPreparationStats;
  /** Record the sealed semantic request immediately before provider dispatch. */
  recordStarted(model: string): void;
  /** Record the normalized semantic outcome and its reported transport retries. */
  recordTerminal(input: {
    readonly model: string;
    readonly outcome: "succeeded" | "failed" | "cancelled";
    readonly usage?: StatisticsUsageReport;
    readonly transportRetries?: number;
  }): void;
}

/** Create one recorder owned only by the immediate managed language activation. @internal */
export function createPreparationStatistics(): PreparationStatistics {
  const ledger = createMemoryStatisticsLedger();
  const owner: StatisticsOwner = {
    kind: "run",
    id: `prepare_${nextRunId++}`,
  };
  let cursor = 0;
  let lastAt = 0;

  const record = (fact: Parameters<StatisticsLedger["record"]>[0]["fact"]) => {
    const now = Math.max(Date.now(), lastAt);
    lastAt = now;
    cursor += 1;
    ledger.record({ owner, cursor, at: new Date(now), fact });
  };

  return {
    beforeStep({ stepIndex, reason }): StepPreparationStats {
      const snapshot = ledger.snapshot(owner);
      const scope = projectScope(snapshot?.scope);
      return Object.freeze({
        at: new Date(),
        cursor: snapshot?.cursor ?? 0,
        attempt: Object.freeze({
          number: 1,
          reason: reason === "validation-retry" ? reason : "initial",
        }),
        run: scope,
        // An immediate activation has no parent statistics owner.
        root: scope,
        stepIndex,
      });
    },
    recordStarted(model): void {
      record({ kind: "model-call", outcome: "started", model });
    },
    recordTerminal({ model, outcome, usage, transportRetries }): void {
      record({
        kind: "model-call",
        outcome,
        model,
        ...(usage ? { usage } : {}),
      });
      for (let retry = 0; retry < (transportRetries ?? 0); retry += 1) {
        record({ kind: "transport-retry", model });
      }
    },
  };
}

function projectScope(scope: ScopeStats | undefined): PreparationScopeStats {
  if (!scope) return emptyScope();
  return Object.freeze({
    usage: Object.freeze({
      ...(scope.usage.inputTokens !== undefined
        ? { inputTokens: scope.usage.inputTokens }
        : {}),
      ...(scope.usage.outputTokens !== undefined
        ? { outputTokens: scope.usage.outputTokens }
        : {}),
      ...(scope.usage.totalTokens !== undefined
        ? { totalTokens: scope.usage.totalTokens }
        : {}),
      coverage: Object.freeze({ ...scope.usage.coverage }),
    }),
    modelCalls: Object.freeze({ ...scope.modelCalls }),
  });
}

function emptyScope(): PreparationScopeStats {
  return Object.freeze({
    usage: Object.freeze({
      coverage: Object.freeze({ tokens: "none" as const, cost: "none" as const }),
    }),
    modelCalls: Object.freeze({
      started: 0,
      succeeded: 0,
      failed: 0,
      cancelled: 0,
      transportRetries: 0,
    }),
  });
}
