/**
 * First-party native evidence binding over opaque artifact capabilities.
 *
 * @internal
 * @module
 */

import { observe } from "../observability";
import { sha256Hex } from "../content/sha256";
import { canonicalEvidenceJson } from "./canonical-json";
import { recordEvidence } from "./record";
import type { EvidenceConclusion, EvidenceRole } from "./roles";
import type { EvidenceRecordInput, EvidenceRef } from "./record-types";
import { evidenceSubjectKey, type EvidenceSubject } from "./subjects";
import {
  nativeEvidenceArtifactState,
  type NativeEvidenceArtifactCapability,
} from "./native-artifact";
import { validateEvidenceSubject } from "./reference-validation";

interface NativeEvidenceInputBase<R extends EvidenceRole> {
  /** Opaque proof for the already-created source artifact. */
  readonly artifact: NativeEvidenceArtifactCapability;
  /** Exact canonical value described by this relationship. */
  readonly subject: EvidenceSubject;
  /** Fixed semantic role asserted at the domain chokepoint. */
  readonly role: R;
  /** ISO timestamp at which the domain observation occurred. */
  readonly observedAt?: string;
  /** Earlier same-subject, same-role relationships explicitly replaced. */
  readonly supersedes?: EvidenceRef<R> | readonly EvidenceRef<R>[];
}

type NativeEvidenceInputForRole<R extends EvidenceRole> =
  NativeEvidenceInputBase<R> &
    ([EvidenceConclusion<R>] extends [never]
      ? { readonly conclusion?: never }
      : { readonly conclusion?: EvidenceConclusion<R> });

/** Exact input accepted by the package-private native binding helper. */
export type NativeEvidenceInput<R extends EvidenceRole = EvidenceRole> = {
  readonly [K in R]: NativeEvidenceInputForRole<K>;
}[R];

/**
 * Bind one already-created native artifact to one exact evidence subject.
 *
 * @remarks Identity is transport-replay-safe for the exact artifact instance.
 * A new random artifact ID is intentionally a new claim, even when its
 * content is identical.
 */
export function recordNativeEvidence<const R extends EvidenceRole>(
  input: NativeEvidenceInput<R>,
): EvidenceRef<R> {
  validateEvidenceSubject(input.subject);
  const artifact = nativeEvidenceArtifactState(input.artifact);
  const idempotencyKey = nativeEvidenceIdempotencyKey({
    artifactId: artifact.artifactId,
    subjectKey: evidenceSubjectKey(input.subject),
    role: input.role,
    evidenceKind: artifact.kind,
  });
  const evidenceInput = {
    subject: input.subject,
    role: input.role,
    ref: { kind: "artifact", id: artifact.artifactId },
    kind: artifact.kind,
    idempotencyKey,
    ...("conclusion" in input && input.conclusion !== undefined
      ? { conclusion: input.conclusion }
      : {}),
    ...(input.observedAt !== undefined ? { observedAt: input.observedAt } : {}),
    ...(input.supersedes !== undefined ? { supersedes: input.supersedes } : {}),
  } as EvidenceRecordInput<R>;
  const recorded = observe.withContext(artifact.context, () =>
    recordEvidence(evidenceInput),
  );
  if (recorded instanceof Promise) {
    throw new TypeError("Native evidence recording must remain synchronous.");
  }
  return recorded as EvidenceRef<R>;
}

interface NativeEvidenceIdentity {
  readonly artifactId: string;
  readonly subjectKey: string;
  readonly role: EvidenceRole;
  readonly evidenceKind: string;
}

function nativeEvidenceIdempotencyKey(
  identity: NativeEvidenceIdentity,
): string {
  const canonical = canonicalEvidenceJson({
    version: 1,
    artifactId: identity.artifactId,
    subjectKey: identity.subjectKey,
    role: identity.role,
    evidenceKind: identity.evidenceKind,
  });
  return `crux.native:v1:${sha256Hex(new TextEncoder().encode(canonical))}`;
}
