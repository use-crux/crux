import type { EvidenceConclusion, EvidenceRole } from "../evidence";
import type { CruxCanonicalArtifactKind } from "../observability";

/**
 * Privacy-safe classification of an authored evidence kind.
 *
 * @remarks Invalid and unresolved values intentionally omit the authored text.
 * Project Index may diagnose the expression, but never retains arbitrary
 * evidence vocabulary that failed the bounded runtime contract.
 */
export type EvidenceRecordKindFact =
  | {
      readonly classification: "canonical";
      readonly value: CruxCanonicalArtifactKind;
    }
  | {
      /**
       * A bounded application-authored value that is safe to group and filter.
       *
       * @remarks Unlike invalid or unresolved values, a valid custom kind is
       * retained because it has passed the runtime evidence-kind contract.
       */
      readonly classification: "custom";
      readonly value: `custom.${string}`;
    }
  | { readonly classification: "invalid" }
  | { readonly classification: "unresolved" };

/** Closed conclusion vocabulary that may be retained in authored index facts. */
export type EvidenceRecordConclusionFact = Exclude<
  EvidenceConclusion<EvidenceRole>,
  never
>;

/**
 * Safe authored facts for a canonical `evidence.record()` callsite.
 *
 * @remarks These facts describe only the statically proven shape. Payloads,
 * subjects, source references, idempotency keys, and expression values are
 * deliberately excluded.
 */
export interface EvidenceRecordFacts {
  readonly kind: "evidence.record";
  readonly role: EvidenceRole | "unresolved";
  readonly evidenceKind: EvidenceRecordKindFact;
  readonly conclusion?: EvidenceRecordConclusionFact;
  readonly sourceForm: "inline" | "reference" | "invalid" | "unresolved";
  readonly subjectMode: "ambient" | "explicit";
  /** Whether the author supplied the property, regardless of value shape. */
  readonly idempotent: boolean;
  /** Whether the author supplied the property, regardless of value shape. */
  readonly supersedes: boolean;
}
