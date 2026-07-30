import type { JsonValue } from "../storage";
import type { CruxRunId, CruxSpanId } from "../observability/contract";
import type {
  EvidenceConclusion,
  EvidenceKind,
  EvidenceRole,
} from "./roles";
import type {
  EvidenceExecutionRef,
  EvidenceSourceRef,
  EvidenceSubject,
} from "./subjects";

/**
 * Stable identity of one qualified evidence relationship.
 *
 * @remarks This identity is independent from artifact, edge, and transport
 * record IDs.
 */
export type CruxEvidenceId = string & {
  readonly __brand: "CruxEvidenceId";
};

interface EvidenceRecordInputBase<R extends EvidenceRole> {
  /**
   * Value this evidence describes.
   *
   * @remarks Omit inside a Crux execution to use its current span or run.
   */
  readonly subject?: EvidenceSubject;
  /** Fixed semantic role played by this relationship. */
  readonly role: R;
  /** ISO timestamp at which the domain observation occurred. */
  readonly observedAt?: string;
  /** Earlier same-subject, same-role relationships explicitly replaced. */
  readonly supersedes?: EvidenceRef<R> | readonly EvidenceRef<R>[];
  /**
   * Optional retry identity.
   *
   * @remarks The raw value never appears in refs, records, graph attributes,
   * errors, or telemetry.
   */
  readonly idempotencyKey?: string;
}

type EvidenceSourceInput =
  | {
      /** Application-defined kind for an inline evidence artifact. */
      readonly kind: `custom.${string}`;
      /** JSON-safe inline source content. */
      readonly data: JsonValue;
      /** Existing references cannot be combined with inline content. */
      readonly ref?: never;
    }
  | {
      /** Existing canonical source to link without copying its payload. */
      readonly ref: EvidenceSourceRef;
      /** Source kind, required when Core cannot resolve it synchronously. */
      readonly kind?: EvidenceKind;
      /** Inline content cannot be combined with an existing reference. */
      readonly data?: never;
    };

type EvidenceRecordForRole<R extends EvidenceRole> =
  EvidenceRecordInputBase<R> &
    EvidenceSourceInput &
    ([EvidenceConclusion<R>] extends [never]
      ? { readonly conclusion?: never }
      : { readonly conclusion?: EvidenceConclusion<R> });

/**
 * Input accepted by `evidence.record()`.
 *
 * @remarks Exactly one of inline `data` or an existing `ref` is required.
 * Conclusions and supersession references remain correlated to `role`.
 */
export type EvidenceRecordInput<
  R extends EvidenceRole = EvidenceRole,
> = {
  readonly [K in R]: EvidenceRecordForRole<K>;
}[R];

/** Portable reference returned after Core accepts an evidence relationship. */
export interface EvidenceRef<R extends EvidenceRole = EvidenceRole> {
  /** Stable discriminant for evidence relationship references. */
  readonly kind: "execution.evidence";
  /** Stable evidence relationship identifier. */
  readonly id: CruxEvidenceId;
  /** Value this relationship describes. */
  readonly subject: EvidenceSubject;
  /** Semantic role this relationship plays for the subject. */
  readonly role: R;
  /** Canonical or custom kind of the evidence source. */
  readonly evidenceKind: EvidenceKind;
  /** ISO timestamp at which Core accepted the relationship. */
  readonly recordedAt: string;
}

/** Availability of safe source content retained with an evidence record. */
export type EvidencePayloadState =
  | "available"
  | "reference"
  | "redacted"
  | "not-captured";

/**
 * Why a destination knows that previously retained evidence data is
 * unavailable.
 *
 * @remarks The reason is optional and appears only with a `redacted` payload.
 * A destination may omit it when the reason is unknown or would disclose
 * inaccessible policy details.
 */
export type EvidencePayloadUnavailableReason =
  | "policy"
  | "retention"
  | "access";

/**
 * Destination-derived proof that a relationship was first accepted after an
 * explicit terminal record for the referenced execution.
 *
 * @remarks This fact is immutable and destination-local. Its absence means
 * “unknown or not proven”, never “accepted before termination”.
 */
export interface EvidenceAcceptedAfterTerminal {
  /** Execution whose persisted terminal state established the ordering. */
  readonly judgedAgainst:
    | { readonly kind: "run"; readonly id: CruxRunId }
    | { readonly kind: "span"; readonly id: CruxSpanId };
}

interface EvidenceStoredRecordBase<R extends EvidenceRole> {
  /** Portable identity and role metadata. */
  readonly ref: EvidenceRef<R>;
  /** Artifact, execution, or receipt that contains the evidence. */
  readonly source: EvidenceSourceRef;
  /** Optional normalized claim made by the source. */
  readonly conclusion?: EvidenceConclusion<R>;
  /** ISO domain timestamp supplied by the producer. */
  readonly observedAt?: string;
  /** Earlier same-subject, same-role relationships explicitly replaced. */
  readonly supersedes: readonly EvidenceRef<R>[];
  /** Execution that authored the relationship, when available. */
  readonly producer?: EvidenceExecutionRef;
  /**
   * Present only when the destination proved acceptance after an explicit end.
   *
   * @remarks Authorization may cause a destination to omit this metadata.
   */
  readonly acceptedAfterTerminal?: EvidenceAcceptedAfterTerminal;
}

type EvidenceRecordPayload =
  | {
      /** Safe captured data is available, though a query may omit hydration. */
      readonly payloadState: "available";
      /** Safe captured inline content, when requested and permitted. */
      readonly data?: JsonValue;
      readonly payloadUnavailableReason?: never;
    }
  | {
      /** The source is known but inline data is not retained. */
      readonly payloadState: "reference";
      readonly data?: never;
      readonly payloadUnavailableReason?: never;
    }
  | {
      /** Known content is unavailable because of policy, retention, or access. */
      readonly payloadState: "redacted";
      readonly data?: never;
      /** Optional destination-known reason for the unavailable payload. */
      readonly payloadUnavailableReason?: EvidencePayloadUnavailableReason;
    }
  | {
      /** Capture policy deliberately retained no content or reference metadata. */
      readonly payloadState: "not-captured";
      readonly data?: never;
      readonly payloadUnavailableReason?: never;
    };

/** Immutable evidence relationship returned through inspection. */
export type EvidenceRecord<
  R extends EvidenceRole = EvidenceRole,
> = EvidenceStoredRecordBase<R> & EvidenceRecordPayload;
