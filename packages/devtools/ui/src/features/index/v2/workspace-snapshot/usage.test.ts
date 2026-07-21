import { describe, expect, it } from "vitest";
import type { ProjectIndexData } from "@/types";
import { buildIndex } from "../adapt";
import { workspaceSnapshotUsages } from "./usage";

const operations = [
  ["creates_workspace_snapshot", "snapshot.create", "snapshot-access"],
  ["lists_workspace_snapshots", "snapshot.list", "snapshot-access"],
  ["restores_workspace_snapshot", "snapshot.restore", "live-tree-mutation"],
  [
    "deletes_workspace_snapshot",
    "snapshot.delete",
    "snapshot-storage-mutation",
  ],
] as const;

const data = {
  prompts: [],
  contexts: [],
  tools: [],
  project: { root: "/repo" },
  definitions: [
    {
      id: "workspace:scratch",
      kind: "workspace",
      name: "scratch",
      fidelity: "resolved",
    },
    {
      id: "tool:snapshots",
      kind: "tool",
      name: "snapshots",
      fidelity: "resolved",
    },
  ],
  relations: operations.map(([relation, operation, effect], index) => ({
    id: `relation:${operation}`,
    type: `tool.${relation}`,
    from: "tool:snapshots",
    to: "workspace:scratch",
    fidelity: "resolved" as const,
    source: { file: "/repo/src/snapshots.ts", line: 10 + index },
    metadata: {
      workspaceSnapshot: { operation, effect },
      snapshotId: "must-not-project",
    },
  })),
  diagnostics: [],
  lintFindings: [],
  sources: [],
} satisfies ProjectIndexData;

describe("Workspace snapshot Catalog projection", () => {
  it("projects the exact authored operation, effect, owner, and source", () => {
    const usages = workspaceSnapshotUsages(
      buildIndex(data),
      "workspace:scratch",
    );

    expect(usages).toEqual(
      operations.map(([, operation, effect], index) => ({
        relationId: `relation:${operation}`,
        operation,
        effect,
        ownerId: "tool:snapshots",
        ownerName: "snapshots",
        source: { file: "src/snapshots.ts", line: 10 + index },
      })),
    );
    expect(JSON.stringify(usages)).not.toContain("must-not-project");
  });
});
