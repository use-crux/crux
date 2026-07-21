/** Authored Workspace snapshot operations retained by the Project Index. */
export type WorkspaceSnapshotAccessOperation =
  | "snapshot.create"
  | "snapshot.list"
  | "snapshot.restore"
  | "snapshot.delete";

/** Mutation boundary represented by an authored Workspace snapshot operation. */
export type WorkspaceSnapshotAccessEffect =
  | "snapshot-access"
  | "live-tree-mutation"
  | "snapshot-storage-mutation";

/** Compiler-owned projection for one grouped Workspace snapshot method. */
export interface WorkspaceSnapshotAccessSpec {
  readonly operation: WorkspaceSnapshotAccessOperation;
  readonly effect: WorkspaceSnapshotAccessEffect;
  readonly relation: `${string}_workspace_snapshot${string}`;
}

const workspaceSnapshotAccessManifest = {
  create: {
    operation: "snapshot.create",
    effect: "snapshot-access",
    relation: "creates_workspace_snapshot",
  },
  list: {
    operation: "snapshot.list",
    effect: "snapshot-access",
    relation: "lists_workspace_snapshots",
  },
  restore: {
    operation: "snapshot.restore",
    effect: "live-tree-mutation",
    relation: "restores_workspace_snapshot",
  },
  delete: {
    operation: "snapshot.delete",
    effect: "snapshot-storage-mutation",
    relation: "deletes_workspace_snapshot",
  },
} as const satisfies Readonly<Record<string, WorkspaceSnapshotAccessSpec>>;

/** Returns the Project Index projection for a grouped snapshot facet method. */
export function workspaceSnapshotAccessForMethod(
  method: string,
): WorkspaceSnapshotAccessSpec | undefined {
  return Object.hasOwn(workspaceSnapshotAccessManifest, method)
    ? workspaceSnapshotAccessManifest[
        method as keyof typeof workspaceSnapshotAccessManifest
      ]
    : undefined;
}

/** Relation suffixes used to declare the compiler-owned relation policies. */
export const workspaceSnapshotAccessRelationSuffixes = Object.values(
  workspaceSnapshotAccessManifest,
).map((spec) => spec.relation);
