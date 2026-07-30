/**
 * Strict qualified attributes for evidence coverage span events.
 *
 * @internal
 * @module
 */

import { z } from "zod";
import { EVIDENCE_ROLES, type EvidenceRole } from "../evidence/roles";
import type { EvidenceExplicitCoverageStatus } from "../evidence/view-types";
import type { CruxGraphNodeRef } from "./contract";

/** Destination-projectable negative evidence coverage. */
export interface EvidenceCoverageEventAttributes {
  /** Canonical value whose role coverage was explicitly classified. */
  readonly subject: CruxGraphNodeRef;
  /** Evidence role classified by the producing span. */
  readonly role: EvidenceRole;
  /** Explicit reason that usable evidence is not present. */
  readonly status: EvidenceExplicitCoverageStatus;
}

const spanId = z
  .string()
  .regex(/^[0-9a-f]{16}$/u)
  .refine((value) => !/^0+$/u.test(value), {
    message: "Span IDs must not be all zeroes",
  });

const graphNode = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("run"), id: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("span"), id: spanId }).strict(),
  z.object({ kind: z.literal("artifact"), id: z.string().min(1) }).strict(),
]);

/** Runtime validator for canonical `evidence.coverage` attributes. */
export const EvidenceCoverageEventAttributesSchema = z
  .object({
    subject: graphNode,
    role: z.enum(EVIDENCE_ROLES),
    status: z.enum([
      "not-configured",
      "not-applicable",
      "not-captured",
      "redacted",
    ]),
  })
  .strict();

/** Runtime validator for the bounded conflict diagnostic. */
export const EvidenceCoverageConflictAttributesSchema = z
  .object({
    role: z.enum(EVIDENCE_ROLES),
  })
  .strict();
