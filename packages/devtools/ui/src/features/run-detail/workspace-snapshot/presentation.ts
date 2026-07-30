import type {
  ObservabilityRunDetailNode,
  WorkspaceSnapshotErrorCode,
} from "@/types";
import {
  workspaceSnapshotErrorCode,
  projectWorkspaceSnapshotPresentation,
  workspaceSnapshotSummary,
  type WorkspaceSnapshotPresentation,
} from "@/shared/lib/workspace-snapshot";

export type WorkspaceSnapshotRunPresentation = WorkspaceSnapshotPresentation;

/** Projects one snapshot span into the closed, privacy-safe run-card contract. */
export function projectWorkspaceSnapshotRun(
  node: ObservabilityRunDetailNode,
): WorkspaceSnapshotRunPresentation | undefined {
  if (node.primitive !== "workspace.operation") return undefined;
  const attributes = node.attributes ?? {};
  const failed =
    node.status === "error" || node.status === "failed" || Boolean(node.error);
  return projectWorkspaceSnapshotPresentation({
    ...attributes,
    status: failed ? "error" : "success",
    errorCode: snapshotRunErrorCode(node.error, attributes.errorCode),
  });
}

/** Formats the purpose-built human summary shown for a snapshot span. */
export function workspaceSnapshotRunSummary(
  presentation: WorkspaceSnapshotRunPresentation,
): string {
  return workspaceSnapshotSummary(presentation);
}

export { projectWorkspaceSnapshotPresentation };

function snapshotRunErrorCode(
  error: ObservabilityRunDetailNode["error"],
  attributeCode: unknown,
): WorkspaceSnapshotErrorCode | undefined {
  const errorCode =
    typeof error === "object" && error !== null ? error.category : undefined;
  return workspaceSnapshotErrorCode(errorCode ?? attributeCode);
}
