/** Atomic application Flow Work acceptance. */

import type { EffectScopeRef } from "../../../effect";
import type { JsonValue } from "../../../storage";
import type { FlowId, RuntimeTargetId, WorkId } from "../../ports/ids";
import type { FlowSnapshot } from "../../ports/state";
import type { RuntimeTargetDefinitionRef } from "../../ports/target-definition";
import type { RuntimeStoreTransaction } from "../../store";
import type { RuntimeCompositeDeps } from "../composites";
import { wakeEnvelopeForWork } from "../kernel-shared";
import type { RuntimeWorkItem } from "../work";
import { createRuntimeError } from "../errors";

/** Immutable inputs for one top-level application Work occurrence. */
export interface WorkAcceptCompositeInput {
  readonly namespace: string;
  readonly workId: WorkId;
  readonly flowId: FlowId;
  readonly targetId: RuntimeTargetId;
  readonly definition: RuntimeTargetDefinitionRef;
  readonly input: JsonValue;
  readonly effects: EffectScopeRef;
  readonly deliveryKey: string;
}

/** Stable records returned for first acceptance and compatible replay. */
export interface WorkAcceptCompositeResult {
  readonly work: RuntimeWorkItem;
  readonly snapshot: FlowSnapshot;
  readonly accepted: boolean;
}

/** Create one Work row, initial Flow snapshot, and wake obligation atomically. */
export async function acceptWorkInTransaction(
  tx: RuntimeStoreTransaction,
  deps: RuntimeCompositeDeps,
  input: WorkAcceptCompositeInput,
): Promise<WorkAcceptCompositeResult> {
  const existing = await tx.state.getWork(input.workId, {
    namespace: input.namespace,
  });
  if (existing) {
    const snapshot = await tx.state.getSnapshot(input.flowId, {
      namespace: input.namespace,
    });
    if (!snapshot) {
      throw new Error(
        `Accepted Work \`${input.workId}\` has no Flow snapshot.`,
      );
    }
    if (
      existing.targetId !== input.targetId ||
      existing.work.kind !== "flow.resume" ||
      existing.work.flowId !== input.flowId ||
      canonicalJson(snapshot.input) !== canonicalJson(input.input)
    ) {
      throw idempotencyConflict(input);
    }
    return Object.freeze({ work: existing, snapshot, accepted: false });
  }

  const now = deps.now();
  const work = await tx.state.createWork({
    workId: input.workId,
    namespace: input.namespace,
    work: { kind: "flow.resume", flowId: input.flowId },
    targetId: input.targetId,
    idempotencyKey: input.deliveryKey,
    now,
  });
  const snapshot: FlowSnapshot = Object.freeze({
    flowId: input.flowId,
    workId: input.workId,
    targetId: input.targetId,
    definition: input.definition,
    resultObligation: Object.freeze({ kind: "required" }),
    namespace: input.namespace,
    status: "running",
    effects: input.effects,
    input: input.input,
    completedSteps: Object.freeze({}),
    fingerprint: Object.freeze([]),
    pendingSuspends: Object.freeze([]),
    scheduledWork: Object.freeze({}),
    updatedAt: now,
  });
  await tx.state.putSnapshot(snapshot);
  await tx.outbox.put(wakeEnvelopeForWork(work), { deliverAt: now });
  return Object.freeze({ work, snapshot, accepted: true });
}

function canonicalJson(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Readonly<Record<string, JsonValue | undefined>>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key]!)}`)
      .join(",")}}`;
  }
  if (typeof value === "number" && Object.is(value, -0)) return "-0";
  return JSON.stringify(value);
}

function idempotencyConflict(input: WorkAcceptCompositeInput): never {
  throw createRuntimeError({
    code: "WORK_IDEMPOTENCY_CONFLICT",
    whatFailed: `Work idempotency key for target \`${input.targetId}\` was already accepted with different input.`,
    why: "One Runtime namespace, target, and caller key must identify exactly one normalized input.",
    whatStillWorks:
      "The previously accepted Work remains unchanged and reconnectable by id.",
    nextStep: "Reuse the original input or choose a new idempotency key.",
  });
}
