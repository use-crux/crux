/** Public projections of one canonical durable Session summary. */

import type { ResolvedRuntimeEngine } from "../runtime/api/create-runtime";
import { sessionStatistics } from "../runtime/engine/session-statistics";
import type { RuntimeSessionInputRecord } from "../runtime/ports/sessions";
import type { ExecutionStats } from "../work";
import { SessionNotFoundError } from "./errors";
import type { SessionInspection, SessionStatus } from "./types";
import { parsePreparedSessionTurn } from "./prepared-execution";

const INSPECTION_INPUT_LIMIT = 64;

/** Read a detached compact status without scanning child Work rows. */
export async function readSessionStatus(
  runtime: Pick<ResolvedRuntimeEngine, "namespace" | "store">,
  sessionId: string,
): Promise<SessionStatus> {
  const record = await readSession(runtime, sessionId);
  if (record.state === "deleted") {
    throw new SessionNotFoundError(sessionId);
  }
  const state =
    record.state === "closing"
      ? "closing"
      : record.state === "closed" || record.state === "killed"
        ? "closed"
        : record.blockedWork > 0
          ? "blocked"
          : record.pendingInputs > 0 || record.pendingWork > 0
            ? "running"
            : "parked";
  return Object.freeze({
    state,
    ...(record.acceptedCursor > 0
      ? { acceptedCursor: String(record.acceptedCursor) }
      : {}),
    ...(record.processedCursor === undefined
      ? {}
      : { processedCursor: String(record.processedCursor) }),
    pendingInputs: record.pendingInputs,
    pendingWork: record.pendingWork,
  });
}

/** Read the existing detached bounded statistics aggregate for this Session. */
export async function readSessionStats(
  runtime: Pick<ResolvedRuntimeEngine, "namespace" | "store">,
  sessionId: string,
): Promise<ExecutionStats> {
  const record = await readSession(runtime, sessionId);
  return sessionStatistics(record.statistics, record.sessionId);
}

/** Read the newest payload-free input identities with explicit bounded coverage. */
export async function readSessionInspection(
  runtime: Pick<ResolvedRuntimeEngine, "namespace" | "store">,
  sessionId: string,
): Promise<SessionInspection> {
  const record = await readSession(runtime, sessionId);
  const sessions = runtime.store.sessions;
  if (!sessions) throw new SessionNotFoundError(sessionId);
  const page = await sessions.inspectInputs(
    runtime.namespace,
    sessionId,
    INSPECTION_INPUT_LIMIT,
  );
  const preparedInput = [...page.inputs]
    .reverse()
    .find((input) => input.preparedExecution !== undefined);
  const prepared = preparedInput
    ? await readPreparedInspection(runtime, preparedInput)
    : undefined;
  return Object.freeze({
    id: record.sessionId,
    targetId: record.targetId,
    threadId: record.threadId,
    wakePending: record.wakePending,
    inputs: Object.freeze(
      page.inputs.map((input) =>
        Object.freeze({
          id: input.inputId,
          cursor: String(input.cursor),
          state: input.work?.state ?? "accepted",
          ...(input.work ? { workId: input.work.workId } : {}),
          checkpointPrepared: input.preparedExecution !== undefined,
          ...(input.delivery
            ? {
                delivery: Object.freeze({
                  stepIndex: input.delivery.stepIndex,
                  reason: input.delivery.reason,
                  deliveredAt: new Date(input.delivery.deliveredAt),
                }),
              }
            : {}),
        }),
      ),
    ),
    ...(prepared?.checkpoint ? { checkpoint: prepared.checkpoint } : {}),
    ...(prepared?.recovery ? { recovery: prepared.recovery } : {}),
    coverage: Object.freeze({
      inputs: page.truncated ? "truncated" : "complete",
      limit: INSPECTION_INPUT_LIMIT,
    }),
  });
}

async function readPreparedInspection(
  runtime: Pick<ResolvedRuntimeEngine, "namespace" | "store">,
  input: RuntimeSessionInputRecord,
): Promise<Pick<SessionInspection, "checkpoint" | "recovery">> {
  const checkpoint = input.preparedExecution;
  const results = runtime.store.results;
  if (!checkpoint || !results) return recoveryDiagnostic();
  try {
    const payload = await results.get(checkpoint.preparedResultRef);
    if (payload === null) return recoveryDiagnostic();
    const prepared = parsePreparedSessionTurn(payload);
    const requestIds = prepared.preparationDecisions.map(
      (decision) => decision.sealedRequestId,
    );
    const basis = prepared.publication.basis;
    if (!basis) return recoveryDiagnostic();
    return Object.freeze({
      checkpoint: Object.freeze({
        inputId: input.inputId,
        workId: checkpoint.workId,
        checkpointedAt: new Date(checkpoint.checkpointedAt),
        thread: Object.freeze({
          revision: basis.revision,
          range: basis.range,
          offset: basis.offset,
          length: basis.length,
          ...(basis.start ? { start: basis.start } : {}),
          ...(basis.end ? { end: basis.end } : {}),
        }),
        requestIds: Object.freeze(requestIds.slice(-INSPECTION_INPUT_LIMIT)),
        requestCoverage:
          requestIds.length > INSPECTION_INPUT_LIMIT ? "truncated" : "complete",
      }),
    });
  } catch {
    return recoveryDiagnostic();
  }
}

function recoveryDiagnostic(): Pick<SessionInspection, "recovery"> {
  return Object.freeze({
    recovery: Object.freeze({
      code: "SESSION_TURN_RESULT_ARTIFACT_UNAVAILABLE",
      nextStep:
        "Restore the Runtime result store from a consistent backup, then retry the turn.",
    }),
  });
}

async function readSession(
  runtime: Pick<ResolvedRuntimeEngine, "namespace" | "store">,
  sessionId: string,
) {
  const record = await runtime.store.sessions?.get(
    runtime.namespace,
    sessionId,
  );
  if (!record) throw new SessionNotFoundError(sessionId);
  return record;
}
