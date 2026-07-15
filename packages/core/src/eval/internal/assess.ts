/** Shared assertion assessment for one executed Eval cell. @internal */

import type { CaseContext } from "../../quality/expect";
import type { Capability } from "../../quality/target";
import {
  runAssertionCallbacks,
  type AssertionCallback,
} from "../../quality/internal/assertion-callbacks";
import {
  createAssertionRecorder,
  createRuntimeBoundExpect,
} from "../../quality/internal/expect-runtime";
import { createStepAccessor } from "../../quality/internal/expect-runtime";
import type { CellSignals } from "../../quality/internal/signals";
import { invokeScorer } from "../../quality/internal/scorer-runtime";
import type { Score } from "../../quality/scorers";
import { resolveEvalScorers } from "./scorer-plan";
import type {
  EvalAssertionSummary,
  EvalPlannedCell,
  EvalScoreEvidence,
  EvalTaskExecutionEvidence,
} from "./types";

export async function assessEvalCell(input: {
  readonly planExpect?: unknown;
  readonly scorers: unknown;
  readonly cell: EvalPlannedCell;
  readonly execution: EvalTaskExecutionEvidence;
  readonly managedScores?: readonly EvalScoreEvidence[];
}): Promise<{
  readonly assertions: EvalAssertionSummary;
  readonly scores: readonly EvalScoreEvidence[];
  readonly error?: {
    readonly message: string;
    readonly phase: "expect" | "score";
  };
}> {
  const signals: CellSignals = {
    ...emptySignals(),
    captured: new Set<Capability>(input.execution.capturedSignals),
  };
  const recorder = createAssertionRecorder();
  let cellErrored = false;
  const context = createContext(recorder);
  const callbacks: AssertionCallback<typeof context>[] = [];
  if (typeof input.planExpect === "function") {
    callbacks.push({
      phase: "expect",
      level: "evaluation",
      fn: input.planExpect as never,
    });
  }
  if (typeof input.cell.expect === "function") {
    callbacks.push({
      phase: "expect",
      level: "case",
      fn: input.cell.expect as never,
    });
  }
  const result = await runAssertionCallbacks({
    callbacks,
    context,
    recorder,
    createCountingContext: createContext,
  });
  if (result.error !== undefined) cellErrored = true;
  const assertions = Object.freeze({
    ran: recorder.ran,
    notEvaluated: result.notEvaluated,
    outcomes: Object.freeze(
      recorder.outcomes.map((outcome) => Object.freeze({ ...outcome })),
    ),
  });
  const scoreResult =
    result.error === undefined
      ? await runDeterministicScorers(input.scorers, input, signals)
      : { scores: Object.freeze([] as const) };
  const managedScores = input.managedScores ?? [];
  const managedError = managedScores.find(
    (score) => score.status === "errored",
  );
  return {
    assertions,
    scores: Object.freeze([...scoreResult.scores, ...managedScores]),
    ...(result.error !== undefined
      ? {
          error: Object.freeze({
            message: result.error.message,
            phase: "expect" as const,
          }),
        }
      : scoreResult.error !== undefined
        ? { error: scoreResult.error }
        : managedError !== undefined
          ? {
              error: Object.freeze({
                message: managedError.message,
                phase: "score" as const,
              }),
            }
          : {}),
  };

  function createContext(
    activeRecorder: ReturnType<typeof createAssertionRecorder>,
  ): CaseContext<unknown, unknown, unknown, Capability> {
    return {
      input: input.cell.input,
      output: input.execution.output,
      expected: input.cell.expected,
      expect: createRuntimeBoundExpect({
        signals,
        recorder: activeRecorder,
        capabilities: input.execution.capturedSignals,
        cellDurationMs: () => input.execution.metrics.durationMs,
        cellErrored: () => cellErrored,
      }),
      variant: { name: "current", params: {} },
      trial: 0,
      recordScore() {
        throw new TypeError(
          "Ad-hoc scores are not supported until Eval assessment Phase 7.",
        );
      },
      step: createStepAccessor(signals) as never,
      trace: { id: input.execution.runIds[0] },
      meta: {
        durationMs: input.execution.metrics.durationMs,
        ...(input.execution.metrics.costUsd !== undefined
          ? { costUsd: input.execution.metrics.costUsd }
          : {}),
      },
    };
  }
}

async function runDeterministicScorers(
  raw: unknown,
  input: {
    readonly cell: EvalPlannedCell;
    readonly execution: EvalTaskExecutionEvidence;
  },
  signals: CellSignals,
): Promise<{
  readonly scores: readonly EvalScoreEvidence[];
  readonly error?: { readonly message: string; readonly phase: "score" };
}> {
  const scorers = resolveEvalScorers(raw);
  const scores: EvalScoreEvidence[] = [];
  for (const scorer of scorers) {
    const name = scorer.scorerName ?? scorer.name ?? "(dynamic)";
    if (scorer.costClass === "model") continue;
    try {
      const result = await invokeScorer(
        scorer,
        {
          input: input.cell.input,
          output: input.execution.output,
          expected: input.cell.expected,
        },
        { signals },
      );
      assertValidScore(result);
      scores.push(
        Object.freeze({
          status: "computed",
          reason: "deterministic_local",
          name: result.name,
          contractFingerprint: "local_always_run",
          value: result.score,
          ...(result.label !== undefined ? { label: result.label } : {}),
          ...(typeof result.metadata?.rationale === "string"
            ? { rationale: result.metadata.rationale }
            : {}),
        }),
      );
    } catch (error) {
      const message = `Scorer '${name}' threw: ${error instanceof Error ? error.message : String(error)}`;
      scores.push(errorScore(name, message));
      return {
        scores: Object.freeze(scores),
        error: Object.freeze({ message, phase: "score" }),
      };
    }
  }
  return { scores: Object.freeze(scores) };
}

function assertValidScore(score: Score): void {
  if (
    typeof score.name !== "string" ||
    (score.score !== null &&
      (typeof score.score !== "number" ||
        !Number.isFinite(score.score) ||
        score.score < 0 ||
        score.score > 1))
  ) {
    throw new TypeError(
      "Scorers must return a name and a finite 0-1 score or null.",
    );
  }
}

function errorScore(name: string, message: string): EvalScoreEvidence {
  return Object.freeze({
    status: "errored",
    reason: "scorer_error",
    name,
    contractFingerprint: "local_always_run",
    message,
  });
}

function emptySignals(): Omit<CellSignals, "captured"> {
  return {
    modelCalls: [],
    toolCalls: [],
    steps: [],
    handoffs: [],
    retrievalHits: [],
    citations: [],
    guardrails: [],
    constraints: [],
    memoryOps: [],
    routing: [],
    decisionReport: [],
    operationDurations: [],
    erroredSpans: 0,
    retries: 0,
    usedFallback: false,
  };
}
