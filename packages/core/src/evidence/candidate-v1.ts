/**
 * Canonical representation of a graph-invisible Local staging candidate.
 *
 * @internal
 * @module
 */

import { sha256Hex } from "../content/sha256";
import { canonicalEvidenceJson } from "./canonical-json";
import type { CruxEvidenceId } from "./record-types";
import type { EvidenceKind } from "./roles";

type EvidenceJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly EvidenceJsonValue[]
  | { readonly [key: string]: EvidenceJsonValue };

interface EvidenceCandidateBase {
  readonly version: 1;
  readonly evidenceId: CruxEvidenceId;
  readonly evidenceKind: EvidenceKind;
}

/**
 * Exact logical V1 input to evidence candidate digesting and size accounting.
 *
 * @remarks Presence is semantic: a `null` preview differs from no preview,
 * and `sizeBytes: 0` differs from an absent size.
 */
export type EvidenceCandidateV1 = EvidenceCandidateBase &
  (
    | {
        readonly captureState: "available";
        readonly preview: EvidenceJsonValue;
        readonly hash?: never;
        readonly sizeBytes?: never;
      }
    | {
        readonly captureState: "reference";
        readonly preview?: never;
        readonly hash?: string;
        readonly sizeBytes?: number;
      }
    | {
        readonly captureState: "not-captured";
        readonly preview?: never;
        readonly hash?: never;
        readonly sizeBytes?: never;
      }
  );

/** Serialize a candidate with the shared UTF-8 sorted-key JSON encoding. */
export function canonicalEvidenceCandidateV1(
  candidate: EvidenceCandidateV1,
): Uint8Array {
  return new TextEncoder().encode(canonicalEvidenceJson(candidate));
}

/** Compute the private, destination-local candidate identity. */
export function evidenceCandidateDigestV1(
  candidate: EvidenceCandidateV1,
): `sha256:${string}` {
  return `sha256:${sha256Hex(canonicalEvidenceCandidateV1(candidate))}`;
}
