/** Durable Session identity and accepted-ingress records. @internal */

import type { JsonValue } from "../../storage";
import type { WorkId } from "./ids";
import type { RuntimeResultRef } from "../results/types";
import type { StatisticsLedgerExport } from "../../statistics";

export interface RuntimeSessionRecord {
  readonly schemaVersion: 1;
  readonly namespace: string;
  readonly sessionId: string;
  readonly keyHash: string;
  readonly targetId: string;
  readonly threadId: string;
  /** Immutable statically declared GenerationModel selected when created. */
  readonly model: {
    readonly definitionId: string;
    readonly fingerprint: string;
  };
  readonly state: "prepared" | "ready";
  readonly acceptedCursor: number;
  readonly processedCursor?: number;
  readonly pendingInputs: number;
  readonly pendingWork: number;
  readonly blockedWork: number;
  /** One bounded owner ledger for the complete Session lifetime. */
  readonly statistics: StatisticsLedgerExport;
  readonly wakePending: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface RuntimeSessionInputRecord {
  readonly schemaVersion: 1;
  readonly namespace: string;
  readonly sessionId: string;
  readonly inputId: string;
  readonly cursor: number;
  readonly input: JsonValue;
  readonly acceptedAt: string;
  /** Write-once linkage and lifecycle of this input's canonical Work. */
  readonly work?: RuntimeSessionTurnWork;
  /** Write-once reference to pre-publication execution evidence. */
  readonly preparedExecution?: RuntimeSessionPreparedExecution;
}

export interface RuntimeSessionTurnWork {
  readonly workId: WorkId;
  readonly target: string;
  readonly state: "queued" | "running" | "completed" | "blocked";
}

export interface RuntimeSessionTurnInput {
  readonly namespace: string;
  readonly sessionId: string;
  readonly inputId: string;
  readonly now: Date;
}

export interface LinkRuntimeSessionTurnInput extends RuntimeSessionTurnInput {
  readonly workId: WorkId;
  readonly target: string;
}

/** Durable Session–Work checkpoint for one prepared Agent execution. */
export interface RuntimeSessionPreparedExecution {
  readonly workId: WorkId;
  readonly preparedResultRef: RuntimeResultRef;
  readonly checkpointedAt: string;
}

/** Input accepted by the write-once prepared-execution checkpoint. */
export interface CheckpointRuntimeSessionExecutionInput {
  readonly namespace: string;
  readonly sessionId: string;
  readonly inputId: string;
  readonly workId: WorkId;
  readonly preparedResultRef: RuntimeResultRef;
  readonly now: Date;
}

export interface CreateRuntimeSessionInput {
  readonly namespace: string;
  readonly sessionId: string;
  readonly keyHash: string;
  readonly targetId: string;
  readonly threadId: string;
  readonly model: RuntimeSessionRecord["model"];
  readonly now: Date;
}

export type CreateRuntimeSessionResult =
  | {
      readonly kind: "created" | "existing";
      readonly session: RuntimeSessionRecord;
    }
  | { readonly kind: "conflict"; readonly session: RuntimeSessionRecord };

export interface AcceptRuntimeSessionInputsInput {
  readonly namespace: string;
  readonly sessionId: string;
  readonly inputs: readonly JsonValue[];
  readonly now: Date;
}

/** Storage operations that preserve Session identity and ingress ordering. */
export interface RuntimeSessionStorePort {
  /** Prepare identity without claiming that its cross-store Thread owner exists. */
  create(input: CreateRuntimeSessionInput): Promise<CreateRuntimeSessionResult>;
  getByKey(
    namespace: string,
    keyHash: string,
  ): Promise<RuntimeSessionRecord | null>;
  /** Read one canonical Session summary by public identity. */
  get(
    namespace: string,
    sessionId: string,
  ): Promise<RuntimeSessionRecord | null>;
  /** Mark a prepared Session ready after durable Thread owner registration. */
  markReady(
    namespace: string,
    sessionId: string,
    now: Date,
  ): Promise<RuntimeSessionRecord>;
  /** Atomically append a validated batch and advance the Session cursor. */
  acceptInputs(
    input: AcceptRuntimeSessionInputsInput,
  ): Promise<readonly RuntimeSessionInputRecord[]>;
  /** Link one accepted input to its canonical queued Work exactly once. */
  linkTurn(
    input: LinkRuntimeSessionTurnInput,
  ): Promise<RuntimeSessionInputRecord>;
  /** Record the first canonical execution entry for a linked turn. */
  startTurn(input: RuntimeSessionTurnInput): Promise<RuntimeSessionInputRecord>;
  /** Read one accepted turn's prepared execution checkpoint. */
  getPreparedExecution(
    namespace: string,
    sessionId: string,
    inputId: string,
  ): Promise<RuntimeSessionPreparedExecution | null>;
  /** Retain one prepared execution reference exactly once. */
  checkpointPreparedExecution(
    input: CheckpointRuntimeSessionExecutionInput,
  ): Promise<RuntimeSessionPreparedExecution>;
  /** Complete one published turn and park when no accepted turn remains. */
  completeTurn(input: RuntimeSessionTurnInput): Promise<RuntimeSessionRecord>;
  /** Retain one terminal safe blocker without exposing its payload. */
  blockTurn(input: RuntimeSessionTurnInput): Promise<RuntimeSessionRecord>;
}
