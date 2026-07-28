import type { IndexIndex } from "../adapt";
import type {
  WorkspaceSnapshotEffect,
  WorkspaceSnapshotOperation,
} from "@/shared/lib/workspace-snapshot";

export type WorkspaceSnapshotUsageOperation = WorkspaceSnapshotOperation;

export type WorkspaceSnapshotUsageEffect = WorkspaceSnapshotEffect;

/** Catalog-ready authored usage of one Workspace snapshot facet operation. */
export interface WorkspaceSnapshotUsage {
  readonly relationId: string;
  readonly operation: WorkspaceSnapshotUsageOperation;
  readonly effect: WorkspaceSnapshotUsageEffect;
  readonly ownerId: string;
  readonly ownerName?: string;
  readonly source?: { readonly file: string; readonly line: number };
}

interface WorkspaceSnapshotUsageSpec {
  readonly relationSuffix: string;
  readonly operation: WorkspaceSnapshotUsageOperation;
  readonly effect: WorkspaceSnapshotUsageEffect;
}

const workspaceSnapshotUsageSpecs = [
  {
    relationSuffix: "creates_workspace_snapshot",
    operation: "snapshot.create",
    effect: "snapshot-access",
  },
  {
    relationSuffix: "lists_workspace_snapshots",
    operation: "snapshot.list",
    effect: "snapshot-access",
  },
  {
    relationSuffix: "restores_workspace_snapshot",
    operation: "snapshot.restore",
    effect: "live-tree-mutation",
  },
  {
    relationSuffix: "deletes_workspace_snapshot",
    operation: "snapshot.delete",
    effect: "snapshot-storage-mutation",
  },
] as const satisfies readonly WorkspaceSnapshotUsageSpec[];

/** Projects authored snapshot relations targeting one Workspace definition. */
export function workspaceSnapshotUsages(
  index: IndexIndex,
  workspaceId: string,
): readonly WorkspaceSnapshotUsage[] {
  return index
    .relationsOf(workspaceId)
    .incoming.flatMap((relation) => {
      const spec = workspaceSnapshotUsageSpecs.find(
        (candidate) =>
          relation.type.endsWith(`.${candidate.relationSuffix}`) &&
          hasWorkspaceSnapshotMetadata(relation.metadata, candidate),
      );
      if (!spec) return [];
      const owner = index.byId(relation.from);
      return [
        {
          relationId: relation.id,
          operation: spec.operation,
          effect: spec.effect,
          ownerId: relation.from,
          ...(owner ? { ownerName: owner.name } : {}),
          ...(relation.source
            ? {
                source: {
                  file:
                    index.relPath(relation.source.file) ?? relation.source.file,
                  line: relation.source.line,
                },
              }
            : {}),
        },
      ];
    })
    .sort(
      (left, right) =>
        operationRank(left.operation) - operationRank(right.operation) ||
        left.ownerId.localeCompare(right.ownerId),
    );
}

function hasWorkspaceSnapshotMetadata(
  metadata: Readonly<Record<string, unknown>> | undefined,
  spec: WorkspaceSnapshotUsageSpec,
): boolean {
  const value = metadata?.workspaceSnapshot;
  return (
    isRecord(value) &&
    value.operation === spec.operation &&
    value.effect === spec.effect
  );
}

function operationRank(operation: WorkspaceSnapshotUsageOperation): number {
  return workspaceSnapshotUsageSpecs.findIndex(
    (spec) => spec.operation === operation,
  );
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
