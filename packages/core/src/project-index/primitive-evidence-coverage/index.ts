import type { CruxPrimitiveName } from "../../observability";
import { generationEvidenceCoverage } from "./generation";
import { orchestrationEvidenceCoverage } from "./orchestration";
import { runtimeEvidenceCoverage } from "./runtime";
import { stateEvidenceCoverage } from "./state";
import type { PrimitiveEvidenceCoverageDescriptor } from "./types";

export type {
  PrimitiveEvidenceCoverageDescriptor,
  PrimitiveEvidenceRoleDecision,
} from "./types";

/** Family-split source groups retained for duplicate-key conformance checks. */
export const PRIMITIVE_EVIDENCE_COVERAGE_GROUPS = Object.freeze([
  generationEvidenceCoverage,
  orchestrationEvidenceCoverage,
  stateEvidenceCoverage,
  runtimeEvidenceCoverage,
]);

/**
 * Exhaustive audit descriptor for every canonical observability primitive.
 *
 * @remarks This is static release metadata. Reading it never emits an
 * `evidence.coverage` fact and absence from runtime remains absence.
 */
export const PRIMITIVE_EVIDENCE_COVERAGE = Object.freeze({
  ...generationEvidenceCoverage,
  ...orchestrationEvidenceCoverage,
  ...stateEvidenceCoverage,
  ...runtimeEvidenceCoverage,
}) satisfies Readonly<
  Record<CruxPrimitiveName, PrimitiveEvidenceCoverageDescriptor>
>;
