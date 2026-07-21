/** Shared dependency contract for private snapshot operations. */

import type { AssetStore, RecordStore } from "../../storage";
import type { WorkspaceMutationBatchConfig } from "../mutation-batch";

export interface WorkspaceSnapshotConfig extends WorkspaceMutationBatchConfig {
  readonly workspaceId: string;
  readonly store: RecordStore;
  readonly assets?: AssetStore;
  readonly resolveNamespace: () => Promise<string>;
}

/** Resolve an optional namespace with the same non-empty rule as Workspace. */
export async function resolveSnapshotNamespace(
  config: WorkspaceSnapshotConfig,
  namespace: string | undefined,
): Promise<string> {
  const resolved = namespace ?? (await config.resolveNamespace());
  if (!resolved.trim()) {
    throw new Error(
      "workspace(): namespace must resolve to a non-empty string.",
    );
  }
  return resolved;
}
