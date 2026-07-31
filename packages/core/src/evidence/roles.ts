import type { CruxCanonicalArtifactKind } from "../observability";

/**
 * Semantic question answered by one evidence relationship.
 *
 * @remarks Roles are closed so readers can always project the same five slots.
 * Use a `custom.*` {@link EvidenceKind} for domain-specific vocabulary.
 */
export type EvidenceRole =
  | "intent"
  | "authority"
  | "change"
  | "verification"
  | "recovery";

/**
 * Canonical or application-defined kind of an evidence source.
 *
 * @remarks Application-authored kinds must use a non-empty `custom.*`
 * namespace. Canonical artifact kinds are reserved for existing references.
 */
export type EvidenceKind =
  | CruxCanonicalArtifactKind
  | `custom.${string}`;

interface EvidenceConclusionByRole {
  readonly intent: never;
  readonly authority: "allowed" | "denied" | "revoked" | "inconclusive";
  readonly change: "applied" | "partial" | "no-change" | "unknown";
  readonly verification: "passed" | "failed" | "inconclusive";
  readonly recovery:
    | "available"
    | "unavailable"
    | "succeeded"
    | "failed"
    | "partial";
}

/**
 * Optional normalized conclusion accepted for an evidence role.
 *
 * @remarks `intent` resolves to `never` because provenance is not a verdict.
 */
export type EvidenceConclusion<R extends EvidenceRole> =
  EvidenceConclusionByRole[R];

/** Stable ordered set of roles projected by every evidence view. */
export const EVIDENCE_ROLES = Object.freeze([
  "intent",
  "authority",
  "change",
  "verification",
  "recovery",
] as const satisfies readonly EvidenceRole[]);

/** Runtime conclusion vocabulary keyed by role. @internal */
export const EVIDENCE_CONCLUSIONS_BY_ROLE = Object.freeze({
  intent: Object.freeze([]),
  authority: Object.freeze([
    "allowed",
    "denied",
    "revoked",
    "inconclusive",
  ]),
  change: Object.freeze(["applied", "partial", "no-change", "unknown"]),
  verification: Object.freeze(["passed", "failed", "inconclusive"]),
  recovery: Object.freeze([
    "available",
    "unavailable",
    "succeeded",
    "failed",
    "partial",
  ]),
} as const satisfies {
  readonly [R in EvidenceRole]: readonly EvidenceConclusion<R>[];
});
