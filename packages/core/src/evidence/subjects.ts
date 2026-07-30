import type {
  CruxArtifactId,
  CruxRunId,
  CruxSpanId,
} from "../observability";

/** Reference to a run or span used as an evidence subject or source. */
export interface EvidenceExecutionRef {
  /** Discriminates execution references from artifacts and receipts. */
  readonly kind: "execution";
  /** Canonical Crux run or W3C span identifier. */
  readonly id: CruxRunId | CruxSpanId;
}

/** Reference to a canonical observability artifact. */
export interface EvidenceArtifactRef {
  /** Discriminates artifact references from executions and receipts. */
  readonly kind: "artifact";
  /** Canonical Crux artifact identifier. */
  readonly id: CruxArtifactId;
}

/**
 * Structural reference to a future Effects receipt.
 *
 * @remarks Receipt construction and resolution remain owned by the Effects API.
 */
export interface EvidenceEffectReceiptRef {
  /** Discriminates effect-receipt references. */
  readonly kind: "effect.receipt";
  /** Stable receipt identifier owned by Effects. */
  readonly id: string;
  /** Stable effect definition identifier owned by Effects. */
  readonly effectId: string;
}

/**
 * Value that evidence describes.
 *
 * @remarks Arbitrary strings and external resource IDs are not subjects.
 */
export type EvidenceSubject =
  | EvidenceExecutionRef
  | EvidenceArtifactRef
  | EvidenceEffectReceiptRef;

/**
 * Existing canonical value that contains or represents evidence.
 *
 * @remarks Inline evidence is first projected to an artifact and therefore
 * uses the same source-reference union.
 */
export type EvidenceSourceRef = EvidenceSubject;

/** Return a stable key for an already validated subject. @internal */
export function evidenceSubjectKey(subject: EvidenceSubject): string {
  return subject.kind === "effect.receipt"
    ? `${subject.kind}:${subject.id}:${subject.effectId}`
    : `${subject.kind}:${subject.id}`;
}

/** Freeze a detached subject value. @internal */
export function freezeEvidenceSubject(
  subject: EvidenceSubject,
): EvidenceSubject {
  return Object.freeze({ ...subject });
}
