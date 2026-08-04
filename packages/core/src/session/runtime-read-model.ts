/** Payload-safe Session diagnostics shared by runtime observability and devtools. */

import { registerInspectableResource } from "../runtime-bridge/resources";
import type { ResolvedRuntimeEngine } from "../runtime/api/create-runtime";
import { sessionStatistics } from "../runtime/engine/session-statistics";
import type { RuntimeSessionRecord } from "../runtime/ports/sessions";
import type { Storage } from "../storage";
import { readThreadRevision } from "../thread/store/revision";
import type { ExecutionStats } from "../work";
import { SessionNotFoundError } from "./errors";
import { readSessionInspection, readSessionStatus } from "./inspection";
import type {
  SessionInputDeliveryInspection,
  SessionRecoveryDiagnostic,
  SessionStatus,
} from "./types";

/** Immutable Session identity exposed to operational tooling. */
export interface SessionRuntimeIdentity {
  readonly sessionId: string;
  readonly keyHash: string;
  readonly targetId: string;
  readonly threadId: string;
}

/** Payload-free accepted-input and canonical Work lineage. */
export interface SessionRuntimeInput {
  readonly inputId: string;
  readonly cursor: string;
  readonly state: "accepted" | "queued" | "running" | "completed" | "blocked";
  readonly workId?: string;
  readonly checkpointPrepared: boolean;
  readonly delivery?: Omit<SessionInputDeliveryInspection, "deliveredAt"> & {
    readonly deliveredAt: string;
  };
}

/** Bounded durable checkpoint evidence without provider request identities. */
export interface SessionRuntimeCheckpoint {
  readonly inputId: string;
  readonly workId: string;
  readonly checkpointedAt: string;
  readonly thread: {
    readonly revision: string;
    readonly range: string;
    readonly offset: number;
    readonly length: number;
    readonly start?: string;
    readonly end?: string;
  };
  readonly requestCount: number;
  readonly requestCoverage: "complete" | "truncated";
}

/** Closed, JSON-safe Session read model for existing inspection transports. */
export interface SessionRuntimeReadModel {
  readonly schema: 1;
  readonly identity: SessionRuntimeIdentity;
  readonly status: SessionStatus;
  readonly wakePending: boolean;
  readonly activation?: {
    readonly inputId: string;
    readonly workId: string;
  };
  readonly thread: { readonly revision: string };
  readonly inputs: readonly SessionRuntimeInput[];
  readonly checkpoint?: SessionRuntimeCheckpoint;
  readonly recovery?: SessionRecoveryDiagnostic;
  readonly coverage: {
    readonly inputs: "complete" | "truncated";
    readonly limit: 64;
  };
  readonly stats: ExecutionStats;
}

/** Register one lazily resolved Session resource on the Runtime Bridge. */
export function registerSessionInspectableResource(
  runtime: ResolvedRuntimeEngine,
  sessionId: string,
  storage: Storage,
): void {
  registerInspectableResource({
    resource: `session:${encodeURIComponent(sessionId)}`,
    kind: "session",
    description: `Session: ${sessionId}`,
    operations: ["get"],
    metadata: { sessionId },
    read: () => readSessionRuntimeReadModel(runtime, sessionId, storage),
  });
}

/** Read one closed Session projection without input, output, or provider payloads. */
export async function readSessionRuntimeReadModel(
  runtime: Pick<ResolvedRuntimeEngine, "namespace" | "store">,
  sessionId: string,
  storage: Storage,
): Promise<SessionRuntimeReadModel> {
  const record = await runtime.store.sessions?.get(
    runtime.namespace,
    sessionId,
  );
  if (!record) throw new SessionNotFoundError(sessionId);
  const [status, inspection, revision] = await Promise.all([
    readSessionStatus(runtime, sessionId),
    readSessionInspection(runtime, sessionId),
    readThreadRevision(storage, record.threadId),
  ]);
  return Object.freeze({
    schema: 1,
    identity: identity(record),
    status,
    wakePending: inspection.wakePending,
    ...(record.activation
      ? {
          activation: Object.freeze({
            inputId: record.activation.primaryInputId,
            workId: record.activation.workId,
          }),
        }
      : {}),
    thread: Object.freeze({ revision }),
    inputs: Object.freeze(
      inspection.inputs.map((input) =>
        Object.freeze({
          inputId: input.id,
          cursor: input.cursor,
          state: input.state,
          ...(input.workId ? { workId: input.workId } : {}),
          checkpointPrepared: input.checkpointPrepared,
          ...(input.delivery
            ? {
                delivery: Object.freeze({
                  stepIndex: input.delivery.stepIndex,
                  reason: input.delivery.reason,
                  deliveredAt: input.delivery.deliveredAt.toISOString(),
                }),
              }
            : {}),
        }),
      ),
    ),
    ...(inspection.checkpoint
      ? { checkpoint: checkpoint(inspection.checkpoint) }
      : {}),
    ...(inspection.recovery ? { recovery: inspection.recovery } : {}),
    coverage: inspection.coverage,
    stats: sessionStatistics(record.statistics, record.sessionId),
  });
}

function identity(record: RuntimeSessionRecord): SessionRuntimeIdentity {
  return Object.freeze({
    sessionId: record.sessionId,
    keyHash: record.keyHash,
    targetId: record.targetId,
    threadId: record.threadId,
  });
}

function checkpoint(
  value: NonNullable<
    Awaited<ReturnType<typeof readSessionInspection>>["checkpoint"]
  >,
): SessionRuntimeCheckpoint {
  return Object.freeze({
    inputId: value.inputId,
    workId: value.workId,
    checkpointedAt: value.checkpointedAt.toISOString(),
    thread: value.thread,
    requestCount: value.requestIds.length,
    requestCoverage: value.requestCoverage,
  });
}
