import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ObservabilityRunDetailNode } from "@/types";
import { WorkspaceSnapshotCard } from "./card";
import { projectWorkspaceSnapshotRun } from "./presentation";

function snapshotNode(
  operation: string,
  attributes: Record<string, unknown>,
  failed = false,
): ObservabilityRunDetailNode {
  return {
    primitive: "workspace.operation",
    name: `workspace.${operation}`,
    status: failed ? "error" : "ok",
    attributes: {
      operation,
      path: "/private-path",
      snapshotId: "private-snapshot-id",
      snapshotRef: "private-snapshot-ref",
      content: "private-content",
      manifest: "private-manifest",
      assetUri: "asset://private",
      ...attributes,
    },
    error: failed
      ? {
          name: "WorkspaceSnapshotError",
          category: "corrupt_snapshot",
          message: "private-snapshot-id /private-path asset://private",
        }
      : undefined,
  } as unknown as ObservabilityRunDetailNode;
}

const nodes = [
  snapshotNode("snapshot.create", { fileCount: 2, sizeBytes: 64 }),
  snapshotNode("snapshot.list", { snapshotCount: 3 }),
  snapshotNode("snapshot.restore", {
    restoredFiles: 4,
    deletedFiles: 1,
    unchangedFiles: 2,
  }),
  snapshotNode("snapshot.delete", {}),
  snapshotNode("snapshot.restore", {}, true),
];

describe("WorkspaceSnapshotCard", () => {
  it("projects and renders all snapshot outcomes without private payloads", () => {
    expect(nodes.map(projectWorkspaceSnapshotRun)).toEqual([
      {
        status: "success",
        operation: "snapshot.create",
        fileCount: 2,
        sizeBytes: 64,
      },
      {
        status: "success",
        operation: "snapshot.list",
        snapshotCount: 3,
      },
      {
        status: "success",
        operation: "snapshot.restore",
        restoredFiles: 4,
        deletedFiles: 1,
        unchangedFiles: 2,
      },
      { status: "success", operation: "snapshot.delete" },
      {
        status: "failure",
        operation: "snapshot.restore",
        errorCode: "corrupt_snapshot",
      },
    ]);

    const html = nodes
      .map((node) =>
        renderToStaticMarkup(<WorkspaceSnapshotCard node={node} />),
      )
      .join("\n");
    for (const summary of [
      "Created snapshot — 2 files, 64 bytes",
      "Listed snapshots — 3 snapshots",
      "Restored snapshot — 4 restored, 1 deleted, 2 unchanged",
      "Deleted snapshot",
      "Failure — corrupt_snapshot",
    ]) {
      expect(html).toContain(summary);
    }
    expect(html).not.toMatch(
      /private-path|private-snapshot|private-content|private-manifest|asset:\/\/private/,
    );
  });
});
