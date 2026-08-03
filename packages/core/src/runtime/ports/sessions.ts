/** Durable Session identity and accepted-ingress records. @internal */

import type { JsonValue } from "../../storage";

export interface RuntimeSessionRecord {
  readonly schemaVersion: 1;
  readonly namespace: string;
  readonly sessionId: string;
  readonly keyHash: string;
  readonly targetId: string;
  readonly threadId: string;
  readonly state: "prepared" | "ready";
  readonly acceptedCursor: number;
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
}

export interface CreateRuntimeSessionInput {
  readonly namespace: string;
  readonly sessionId: string;
  readonly keyHash: string;
  readonly targetId: string;
  readonly threadId: string;
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
}
