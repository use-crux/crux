/**
 * Package-private evidence integration seams for first-party Core domains.
 *
 * @internal
 * @module
 */

export { runWithEvidenceEffectReceiptSubject } from "./subject-context";
export { recordEvidenceCoverageFact } from "./coverage";
export type { EvidenceCoverageFact } from "./coverage";
export {
  emitNativeEvidenceArtifact,
  nativeEvidenceArtifactRef,
} from "./native-artifact";
export type { NativeEvidenceArtifactCapability } from "./native-artifact";
export { recordNativeEvidence } from "./native";
export type { NativeEvidenceInput } from "./native";
