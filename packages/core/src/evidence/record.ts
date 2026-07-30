import { createCruxArtifactId, observe } from "../observability";
import { shouldQuarantineEvalObservabilityWrite } from "../observability/eval-capture-hooks";
import type { JsonValue } from "../storage";
import { activeEvidenceCollector } from "./collector";
import { resolveEvidenceExecution } from "./execution-context";
import {
  evidenceKindInvalidError,
  evidenceIdempotencyConflictError,
  evidenceSupersessionInvalidError,
  evidenceWriteQuarantinedError,
} from "./errors";
import {
  assertProjectableEvidenceReference,
  prepareEvidenceGraph,
  prepareEvidenceGraphEmission,
  publishEvidenceGraph,
} from "./graph";
import type { EvidenceKind, EvidenceRole } from "./roles";
import type {
  CruxEvidenceId,
  EvidenceRecord,
  EvidenceRecordInput,
  EvidenceRef,
} from "./record-types";
import {
  freezeEvidenceSubject,
  type EvidenceArtifactRef,
  type EvidenceSourceRef,
} from "./subjects";
import { normalizeEvidenceSupersedes } from "./supersession-validation";
import { validateEvidenceRecordInput } from "./validation";
import {
  deterministicEvidenceArtifactId,
  deterministicEvidenceId,
  evidenceIdempotencyKeyHash,
} from "./idempotency";

/** Validate and synchronously accept one evidence relationship. @internal */
export function recordEvidence<const R extends EvidenceRole>(
  input: EvidenceRecordInput<R>,
): EvidenceRef<R> {
  if (shouldQuarantineEvalObservabilityWrite()) {
    throw evidenceWriteQuarantinedError();
  }
  validateEvidenceRecordInput(input);
  const resolution = resolveEvidenceExecution(input.subject);
  assertProjectableEvidenceReference(resolution.subject);
  if (input.ref !== undefined) {
    assertProjectableEvidenceReference(input.ref);
  }
  if (resolution.context !== undefined) {
    return acceptEvidenceRecord(input);
  }
  return recordInImplicitEvidenceContext(input, resolution.subject);
}

function acceptEvidenceRecord<const R extends EvidenceRole>(
  input: EvidenceRecordInput<R>,
  subjectOverride?: EvidenceSourceRef,
): EvidenceRef<R> {
  const { graphProducer, producer, subject } = resolveEvidenceExecution(
    subjectOverride ?? input.subject,
  );
  if (graphProducer === undefined) {
    throw new TypeError(
      "Evidence graph preparation requires an active execution producer.",
    );
  }
  const recordedAt = new Date().toISOString();
  const inlineData = input.data;
  const evidenceKind = resolveEvidenceKind(input);
  const supersedes = normalizeEvidenceSupersedes(
    input.supersedes,
    subject,
    input.role,
  );
  const evidenceId =
    input.idempotencyKey === undefined
      ? createRandomEvidenceId()
      : deterministicEvidenceId(
          subject,
          input.role,
          evidenceKind,
          input.idempotencyKey,
        );
  assertNoSupersessionCycle(evidenceId, supersedes);
  const source: EvidenceSourceRef =
    inlineData !== undefined
      ? artifactSource(
          evidenceId,
          input.idempotencyKey !== undefined,
        )
      : freezeEvidenceSubject(input.ref) as EvidenceSourceRef;
  const graph = prepareEvidenceGraph(source, subject, graphProducer);
  const ref = Object.freeze({
    kind: "execution.evidence",
    id: evidenceId,
    subject,
    role: input.role,
    evidenceKind,
    recordedAt,
  }) satisfies EvidenceRef<R>;
  const candidate = Object.freeze({
    ref,
    source,
    ...("conclusion" in input && input.conclusion !== undefined
      ? { conclusion: input.conclusion }
      : {}),
    ...(input.observedAt ? { observedAt: input.observedAt } : {}),
    supersedes,
    ...(producer ? { producer } : {}),
    payloadState: inlineData !== undefined ? "available" : "reference",
    ...(inlineData !== undefined
      ? { data: cloneAndFreezeJson(inlineData) }
      : {}),
  }) as EvidenceRecord<R>;
  const idempotencyKeyHash =
    input.idempotencyKey === undefined
      ? undefined
      : evidenceIdempotencyKeyHash(input.idempotencyKey);
  const prepared = prepareEvidenceGraphEmission(
    candidate,
    graph,
    idempotencyKeyHash,
  );
  const contentFingerprint = prepared.contentFingerprint;
  const collector = activeEvidenceCollector(true);
  if (contentFingerprint !== undefined) {
    const occurrence = collector?.idempotentOccurrence(evidenceId);
    if (occurrence !== undefined) {
      if (occurrence.contentFingerprint === contentFingerprint) {
        return occurrence.ref as EvidenceRef<R>;
      }
      throw evidenceIdempotencyConflictError();
    }
  }

  collector?.append(prepared.record, contentFingerprint);
  publishEvidenceGraph(prepared);
  return ref;
}

function recordInImplicitEvidenceContext<const R extends EvidenceRole>(
  input: EvidenceRecordInput<R>,
  subject: EvidenceSourceRef,
): EvidenceRef<R> {
  const span = observe.openSpan({
    name: "record evidence",
    primitive: "evidence.record",
  });
  try {
    const result = span.withContext(() =>
      acceptEvidenceRecord(input, subject),
    );
    if (result instanceof Promise) {
      throw new TypeError("Synchronous evidence recording returned a promise.");
    }
    span.end();
    return result;
  } catch (error) {
    span.error(error);
    throw error;
  }
}

function assertNoSupersessionCycle(
  evidenceId: CruxEvidenceId,
  supersedes: readonly EvidenceRef[],
): void {
  const collector = activeEvidenceCollector(false);
  if (
    supersedes.some((candidate) => candidate.id === evidenceId) ||
    collector?.createsSupersessionCycle(evidenceId, supersedes)
  ) {
    throw evidenceSupersessionInvalidError(
      "The supersession relationship would create a cycle.",
    );
  }
}

function resolveEvidenceKind<R extends EvidenceRole>(
  input: EvidenceRecordInput<R>,
): EvidenceKind {
  if (input.kind !== undefined) return input.kind;
  const localKind = activeEvidenceCollector(false)?.kindForSource(input.ref);
  if (localKind !== undefined) return localKind;
  throw evidenceKindInvalidError(
    "The referenced source has no synchronously resolvable local kind.",
  );
}

function artifactSource(
  evidenceId: CruxEvidenceId,
  deterministic: boolean,
): EvidenceArtifactRef {
  return Object.freeze({
    kind: "artifact",
    id: deterministic
      ? deterministicEvidenceArtifactId(evidenceId)
      : createCruxArtifactId(),
  });
}

function createRandomEvidenceId(): CruxEvidenceId {
  const bytes = new Uint8Array(8);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  const suffix = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `evidence_${suffix}` as CruxEvidenceId;
}

function cloneAndFreezeJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item) => cloneAndFreezeJson(item)));
  }
  if (value !== null && typeof value === "object") {
    return Object.freeze(
      Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key,
          item === undefined ? undefined : cloneAndFreezeJson(item),
        ]),
      ),
    );
  }
  return value;
}
