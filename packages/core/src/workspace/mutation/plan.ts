/** Preparation and local-mount validation for Workspace mutation plans. */

import { analyzeContent } from "../content";
import { mountForPath } from "../path";
import { assertWorkspaceMountIsLocal } from "../virtual-source";
import type { WorkspaceVersionOperation } from "../version-types";
import type {
  ContentAnalysis,
  NormalizedMount,
  WorkspaceContent,
  WorkspaceFileRecord,
  WorkspacePath,
} from "../types";
import type {
  WorkspaceArtifactStatus,
  WorkspaceProvenance,
} from "../artifact-types";

/** A complete logical file state ready to be persisted by a mutation batch. */
export interface MaterializedWorkspaceState {
  readonly content: WorkspaceContent;
  readonly mimeType: string;
  readonly metadata?: WorkspaceFileRecord["metadata"];
  readonly status?: WorkspaceArtifactStatus;
  readonly artifactKind?: string;
  readonly producedBy?: WorkspaceProvenance;
}

/** One unique-path mutation in an internal Workspace batch plan. */
export type WorkspaceMutation =
  | {
      readonly kind: "put";
      readonly path: WorkspacePath;
      readonly head: MaterializedWorkspaceState;
      readonly published?: MaterializedWorkspaceState;
      readonly operation: WorkspaceVersionOperation;
    }
  | { readonly kind: "delete"; readonly path: WorkspacePath };

/** Prepared payload analyses paired with their immutable logical mutations. */
export type PreparedWorkspaceMutation =
  | {
      readonly kind: "put";
      readonly mutation: Extract<WorkspaceMutation, { readonly kind: "put" }>;
      readonly head: ContentAnalysis;
      readonly published?: ContentAnalysis;
    }
  | {
      readonly kind: "delete";
      readonly mutation: Extract<
        WorkspaceMutation,
        { readonly kind: "delete" }
      >;
    };

/** Analyze, deduplicate, and lexically order a complete mutation plan. */
export async function prepareWorkspaceMutations(
  mutations: readonly WorkspaceMutation[],
): Promise<readonly PreparedWorkspaceMutation[]> {
  const paths = new Set<string>();
  const sorted = [...mutations].sort((a, b) => a.path.localeCompare(b.path));
  return Promise.all(
    sorted.map(async (mutation): Promise<PreparedWorkspaceMutation> => {
      if (paths.has(mutation.path)) {
        throw new Error(
          `Workspace mutation plan contains duplicate path "${mutation.path}".`,
        );
      }
      paths.add(mutation.path);
      if (mutation.kind === "delete") return { kind: "delete", mutation };
      return {
        kind: "put",
        mutation,
        head: await analyzeContent(
          mutation.head.content,
          mutation.head.mimeType,
        ),
        ...(mutation.published
          ? {
              published: await analyzeContent(
                mutation.published.content,
                mutation.published.mimeType,
              ),
            }
          : {}),
      };
    }),
  );
}

/** Revalidate that every planned destination uses local Workspace storage. */
export function validateWorkspaceMutationMounts(
  mounts: readonly NormalizedMount[],
  prepared: readonly PreparedWorkspaceMutation[],
): void {
  for (const { mutation } of prepared) {
    assertWorkspaceMountIsLocal(
      mountForPath(mutation.path, mounts, "write"),
      "transaction",
    );
  }
}
