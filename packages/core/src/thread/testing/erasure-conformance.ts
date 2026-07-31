/**
 * Shared erasure behaviors for Storage-backed Threads.
 *
 * @module
 */

import type { Storage } from "../../storage";
import { registerThreadAssetEditConformance } from "./asset-edit-conformance";
import { registerThreadAssetErasureConformance } from "./asset-erasure-conformance";
import { registerThreadDeletionConformance } from "./deletion-conformance";
import { registerThreadRedactionConformance } from "./redaction-conformance";
import { registerThreadRemovalConformance } from "./removal-conformance";

/** Inputs shared by every erasure conformance behavior. */
export interface ErasureConformanceOptions {
  readonly prepare: () => Storage | Promise<Storage>;
}

/** Register irreversible redaction, removal, and deletion behaviors. */
export function registerThreadErasureConformance(
  options: ErasureConformanceOptions,
): void {
  registerThreadRedactionConformance(options);
  registerThreadAssetErasureConformance(options);
  registerThreadAssetEditConformance(options);
  registerThreadRemovalConformance(options);
  registerThreadDeletionConformance(options);
}
