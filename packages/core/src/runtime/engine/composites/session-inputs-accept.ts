/** Atomic Session input acceptance on the canonical Work spine. */

import type { JsonValue } from "../../../storage";
import type {
  RuntimeSessionInputRecord,
  RuntimeSessionRecord,
} from "../../ports/sessions";
import type { RuntimeStoreTransaction } from "../../store";
import type { RuntimeCompositeDeps } from "../composites";
import { reserveNextSessionActivation } from "./session-activation";

/** Keyed Session identity carried by the public admission path. */
export interface SessionInputsAcceptIdentity {
  readonly sessionId: string;
  readonly keyHash: string;
  readonly targetId: string;
  readonly threadId: string;
}

/** Serializable inputs for accepting one ordered Session input group. */
export interface SessionInputsAcceptCompositeInput {
  readonly namespace: string;
  readonly session: SessionInputsAcceptIdentity;
  readonly inputs: readonly JsonValue[];
}

/** Accepted records needed to construct public Session turn handles. */
export type SessionInputsAcceptCompositeResult =
  readonly RuntimeSessionInputRecord[];

/** Validate Session identity, accept ingress, and reserve one wake atomically. */
export async function acceptSessionInputsInTransaction(
  tx: RuntimeStoreTransaction,
  deps: RuntimeCompositeDeps,
  input: SessionInputsAcceptCompositeInput,
): Promise<SessionInputsAcceptCompositeResult> {
  const sessions = tx.sessions;
  if (!sessions) throw new Error("Runtime Session storage is unavailable.");
  const session = await sessions.getByKey(
    input.namespace,
    input.session.keyHash,
  );
  if (!session || !matchesIdentity(session, input.namespace, input.session)) {
    throw new Error(
      `Session "${input.session.sessionId}" does not match its keyed Runtime identity.`,
    );
  }
  if (session.state !== "ready") {
    throw new Error(
      `Session "${session.sessionId}" no longer accepts external ingress.`,
    );
  }
  const now = deps.now();
  const accepted = await sessions.acceptInputs({
    namespace: input.namespace,
    sessionId: session.sessionId,
    inputs: input.inputs,
    now,
  });
  await reserveNextSessionActivation(tx, {
    namespace: input.namespace,
    sessionId: session.sessionId,
    now,
  });
  return Object.freeze([...accepted]);
}

function matchesIdentity(
  record: RuntimeSessionRecord,
  namespace: string,
  identity: SessionInputsAcceptIdentity,
): boolean {
  return (
    record.namespace === namespace &&
    record.sessionId === identity.sessionId &&
    record.keyHash === identity.keyHash &&
    record.targetId === identity.targetId &&
    record.threadId === identity.threadId
  );
}
