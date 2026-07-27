/**
 * Cell-local projection of observability known at a terminal boundary.
 *
 * The tracker receives records synchronously from the Eval capture tee. A
 * timeout can therefore preserve already-observed Run roots and signal
 * capabilities without waiting for the cooperatively cancelled task.
 *
 * @internal
 * @module
 */

import type { CruxGraphRecord } from "../../observability/contract";
import type { ExecutionScope } from "../../scope/contracts";
import { createScopeFacetSlot } from "../../scope/facets";
import { currentScopeFacet } from "../../scope/kernel";
import type { EvalCapability } from "../task";
import type { EvalCaptureSession } from "./capture-context";
import { extractCellSignals } from "./execution-signals";

/** Immutable observability retained by a terminal Eval cell. @internal */
export interface EvalCellObservationSnapshot {
  readonly runIds: readonly string[];
  readonly capturedSignals: readonly EvalCapability[];
}

interface ObservedRunStart {
  readonly runId: string;
  readonly parentRunId?: string;
}

interface EvalCellObservation {
  record(records: readonly CruxGraphRecord[]): void;
  snapshot(): EvalCellObservationSnapshot;
}

const cellObservationSlot = createScopeFacetSlot<EvalCellObservation>(
  "core.eval-cell-observation",
);

const EMPTY_OBSERVATION = Object.freeze({
  runIds: Object.freeze([]),
  capturedSignals: Object.freeze([]),
}) satisfies EvalCellObservationSnapshot;

/** Attach an observation tracker to one newly opened Eval-cell scope. */
export function setEvalCellObservation(
  scope: ExecutionScope,
  capture: EvalCaptureSession | undefined,
): void {
  if (scope.descriptor.kind !== "eval-cell") {
    throw new TypeError("Eval cell observation belongs to an eval-cell scope.");
  }
  scope.setFacet(cellObservationSlot, createCellObservation(capture));
}

/** Record observability emitted by the currently active Eval cell. */
export function recordEvalCellObservation(
  records: readonly CruxGraphRecord[],
): void {
  currentScopeFacet(cellObservationSlot)?.record(records);
}

/** Snapshot observability already known by the currently active Eval cell. */
export function snapshotEvalCellObservation(): EvalCellObservationSnapshot {
  return (
    currentScopeFacet(cellObservationSlot)?.snapshot() ?? EMPTY_OBSERVATION
  );
}

function createCellObservation(
  capture: EvalCaptureSession | undefined,
): EvalCellObservation {
  let runStarts: readonly ObservedRunStart[] = Object.freeze([]);

  return Object.freeze({
    record(records: readonly CruxGraphRecord[]): void {
      runStarts = records.reduce(appendRunStart, runStarts);
    },
    snapshot(): EvalCellObservationSnapshot {
      if (capture === undefined) return EMPTY_OBSERVATION;

      const observedIds = new Set(runStarts.map(({ runId }) => runId));
      const runIds = runStarts
        .filter(
          ({ parentRunId }) =>
            parentRunId === undefined || !observedIds.has(parentRunId),
        )
        .map(({ runId }) => runId);
      const capturedSignals = runIds
        .flatMap((runId) => [
          ...extractCellSignals(capture.take(runId)).captured,
        ])
        .filter((capability, index, all) => all.indexOf(capability) === index);

      return Object.freeze({
        runIds: Object.freeze(runIds),
        capturedSignals: Object.freeze(capturedSignals),
      });
    },
  });
}

function appendRunStart(
  runStarts: readonly ObservedRunStart[],
  record: CruxGraphRecord,
): readonly ObservedRunStart[] {
  if (
    record.type !== "run:start" ||
    runStarts.some(({ runId }) => runId === record.runId)
  ) {
    return runStarts;
  }

  return Object.freeze([
    ...runStarts,
    Object.freeze({
      runId: record.runId,
      ...(record.parentRunId !== undefined
        ? { parentRunId: record.parentRunId }
        : {}),
    }),
  ]);
}
