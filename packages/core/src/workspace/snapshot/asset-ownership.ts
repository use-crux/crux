/** Private integrity proof for snapshot-owned AssetStore references. */

import { hashCanonical } from "./fingerprint";
import type { WorkspaceSnapshotEntry } from "./records";

/** Bind one persisted asset URI to its snapshot entry and payload role. */
export function snapshotAssetOwnershipFingerprint(input: {
  readonly snapshotId: string;
  readonly path: string;
  readonly role: "head" | "published";
  readonly assetUri: string;
}): string {
  return hashCanonical({
    format: "workspace-snapshot-asset-ownership:v1",
    snapshotId: input.snapshotId,
    path: input.path,
    role: input.role,
    assetUri: input.assetUri,
  });
}

/** Verify every asset ref in an entry remains bound to its captured owner. */
export function snapshotEntryAssetOwnershipIsValid(
  entry: WorkspaceSnapshotEntry,
): boolean {
  return (
    stateAssetOwnershipIsValid(entry, entry.head, "head") &&
    (entry.published?.kind !== "distinct" ||
      stateAssetOwnershipIsValid(entry, entry.published.state, "published"))
  );
}

function stateAssetOwnershipIsValid(
  entry: WorkspaceSnapshotEntry,
  state: WorkspaceSnapshotEntry["head"],
  role: "head" | "published",
): boolean {
  const payload = state.payload;
  return (
    payload.storage !== "asset" ||
    payload.ownershipFingerprint ===
      snapshotAssetOwnershipFingerprint({
        snapshotId: entry.snapshotId,
        path: entry.path,
        role,
        assetUri: payload.assetUri,
      })
  );
}
