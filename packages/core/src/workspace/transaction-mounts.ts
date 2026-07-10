/**
 * Mount guards for workspace transactions.
 *
 * Transactions can stage local workspace records, but source-backed providers
 * own their own mutation semantics. Rejecting those writes before calling a
 * provider hook keeps the transaction contract honest.
 *
 * @module
 */

import { mountForPath, normalizePath } from "./path";
import { hasWorkspaceMountSource } from "./virtual-source";
import type { NormalizedMount } from "./types";

/** Assert that a transaction mutation targets a local workspace mount. */
export function assertLocalTransactionMutationPath(
  mounts: readonly NormalizedMount[],
  path: string,
): void {
  const normalized = normalizePath(path);
  const mount = mountForPath(normalized, mounts, "write");
  if (hasWorkspaceMountSource(mount)) {
    throw new Error(
      `workspace.transaction(): source-backed mount "${mount.path}" does not support transaction mutations.`,
    );
  }
}
