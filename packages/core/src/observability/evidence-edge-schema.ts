import { z } from "zod";
import {
  EVIDENCE_CONCLUSIONS_BY_ROLE,
  EVIDENCE_ROLES,
  type EvidenceConclusion,
  type EvidenceKind,
  type EvidenceRole,
} from "../evidence/roles";
import type {
  CruxEvidenceId,
  EvidencePayloadState,
} from "../evidence/record-types";
import { CRUX_CANONICAL_ARTIFACT_KINDS } from "./taxonomy";
import type { CruxRunId, CruxSpanId } from "./contract";
import { isValidCustomEvidenceKind } from "../evidence/kind-validation";

/**
 * Execution that authored a canonical evidence relationship.
 *
 * @remarks The discriminant is explicit on the wire so destinations never
 * infer run-versus-span provenance from opaque identifier text.
 */
export type EvidenceProducer =
  | { readonly kind: "run"; readonly id: CruxRunId }
  | { readonly kind: "span"; readonly id: CruxSpanId };

/** Authored shape of the evidence source before capture policy is applied. */
export type EvidenceSourceMode = "inline" | "reference";

/**
 * Safe qualified metadata carried by a canonical `evidence.for` edge.
 *
 * @remarks Inline payloads and raw idempotency keys are deliberately absent.
 */
export interface EvidenceEdgeAttributes {
  /** Stable evidence relationship identity, distinct from the edge ID. */
  readonly evidenceId: CruxEvidenceId;
  /** Fixed semantic role played by the relationship. */
  readonly role: EvidenceRole;
  /** Canonical or application-defined kind of the evidence source. */
  readonly evidenceKind: EvidenceKind;
  /** Optional conclusion correlated to {@link role}. */
  readonly conclusion?: EvidenceConclusion<EvidenceRole>;
  /** Optional ISO time at which the domain observation occurred. */
  readonly observedAt?: string;
  /** ISO time at which Core accepted the relationship. */
  readonly recordedAt: string;
  /** Nearest active span, otherwise the active run, that authored the claim. */
  readonly producer: EvidenceProducer;
  /** Earlier evidence relationships explicitly replaced by this one. */
  readonly supersedesEvidenceIds?: readonly CruxEvidenceId[];
  /** Safe retained state of the source payload. */
  readonly captureState: EvidencePayloadState;
  /** Authored source shape used by durable identity and read projection. */
  readonly sourceMode: EvidenceSourceMode;
  /** Bounded one-way retry-key digest; never the raw key. */
  readonly idempotencyKeyHash?: string;
  /** Version of the canonical content-digest representation. */
  readonly contentDigestVersion?: 1;
  /** Digest of the final post-policy evidence relationship content. */
  readonly contentDigest?: `sha256:${string}`;
}

const isoTimestamp = z
  .string()
  .refine((value) => Number.isFinite(Date.parse(value)), {
    message: "Expected an ISO-compatible timestamp",
  });

const evidenceId = z
  .string()
  .regex(/^evidence_[0-9a-f]{16,64}$/u)
  .transform((value) => value as CruxEvidenceId);

const producer = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("run"),
      id: z
        .string()
        .min(1)
        .transform((value) => value as CruxRunId),
    })
    .strict(),
  z
    .object({
      kind: z.literal("span"),
      id: z
        .string()
        .regex(/^[0-9a-f]{16}$/u)
        .refine((value) => !/^0+$/u.test(value), {
          message: "Span IDs must not be all zeroes",
        })
        .transform((value) => value as CruxSpanId),
    })
    .strict(),
]);

const customEvidenceKind = z
  .string()
  .refine(isValidCustomEvidenceKind, {
    message: "Custom evidence kinds must use the bounded custom.* namespace",
  })
  .transform((value) => value as `custom.${string}`);

const evidenceKind = z.union([
  z.enum(CRUX_CANONICAL_ARTIFACT_KINDS),
  customEvidenceKind,
]);

const conclusion = z.enum([
  "allowed",
  "denied",
  "revoked",
  "inconclusive",
  "applied",
  "partial",
  "no-change",
  "unknown",
  "passed",
  "failed",
  "available",
  "unavailable",
  "succeeded",
]);

/** Runtime validator for qualified evidence-edge metadata. */
export const EvidenceEdgeAttributesSchema = z
  .object({
    evidenceId,
    role: z.enum(EVIDENCE_ROLES),
    evidenceKind,
    conclusion: conclusion.optional(),
    observedAt: isoTimestamp.optional(),
    recordedAt: isoTimestamp,
    producer,
    supersedesEvidenceIds: z.array(evidenceId).readonly().optional(),
    captureState: z
      .enum(["available", "reference", "redacted", "not-captured"]),
    sourceMode: z.enum(["inline", "reference"]),
    idempotencyKeyHash: z
      .string()
      .regex(/^[0-9a-f]{64}$/u)
      .optional(),
    contentDigestVersion: z.literal(1).optional(),
    contentDigest: z
      .string()
      .regex(/^sha256:[0-9a-f]{64}$/u)
      .transform((value) => value as `sha256:${string}`)
      .optional(),
  })
  .strict()
  .superRefine((attributes, context) => {
    if (
      attributes.conclusion !== undefined &&
      !EVIDENCE_CONCLUSIONS_BY_ROLE[attributes.role].some(
        (candidate) => candidate === attributes.conclusion,
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Evidence conclusion must match its role",
        path: ["conclusion"],
      });
    }
    const durableIdentityFields = [
      attributes.idempotencyKeyHash,
      attributes.contentDigestVersion,
      attributes.contentDigest,
    ];
    const presentCount = durableIdentityFields.filter(
      (value) => value !== undefined,
    ).length;
    if (presentCount !== 0 && presentCount !== durableIdentityFields.length) {
      context.addIssue({
        code: "custom",
        message:
          "Idempotent evidence requires a complete durable content identity",
        path: ["contentDigest"],
      });
    }
    if (
      attributes.sourceMode === "reference" &&
      attributes.captureState !== "reference"
    ) {
      context.addIssue({
        code: "custom",
        message: "Reference-authored evidence requires reference capture state",
        path: ["captureState"],
      });
    }
    if (
      attributes.supersedesEvidenceIds !== undefined &&
      new Set(attributes.supersedesEvidenceIds).size !==
        attributes.supersedesEvidenceIds.length
    ) {
      context.addIssue({
        code: "custom",
        message: "Evidence supersession identities must be unique",
        path: ["supersedesEvidenceIds"],
      });
    }
  });
