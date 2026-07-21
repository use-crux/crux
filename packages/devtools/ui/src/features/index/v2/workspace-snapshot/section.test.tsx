import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ProjectIndexData } from "@/types";
import { buildIndex } from "../adapt";
import { IndexIndexProvider } from "../context";
import { indexSectionOrder } from "../detail";
import { IndexWorkspaceSnapshotUsage } from "./section";

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
      name: "Snapshot manager",
      fidelity: "resolved",
    },
  ],
  relations: operations.map(([relation, operation, effect], index) => ({
    id: `relation:${operation}`,
    type: `tool.${relation}`,
    from: "tool:snapshots",
    to: "workspace:scratch",
    fidelity: "resolved" as const,
    source: { file: "/repo/src/snapshots.ts", line: 20 + index },
    metadata: {
      workspaceSnapshot: { operation, effect },
      snapshotId: "private-snapshot-id",
      snapshotRef: "private-snapshot-ref",
    },
  })),
  diagnostics: [],
  lintFindings: [],
  sources: [],
} satisfies ProjectIndexData;

describe("Workspace snapshot Catalog section", () => {
  it("renders authored operations, effects, owners, and source locations", () => {
    const index = buildIndex(data);
    const html = renderToStaticMarkup(
      <IndexIndexProvider index={index}>
        <IndexWorkspaceSnapshotUsage def={index.byId("workspace:scratch")!} />
      </IndexIndexProvider>,
    );

    expect(html).toContain("Authored snapshot usage");
    expect(html).toContain("Create snapshot");
    expect(html).toContain("List snapshots");
    expect(html).toContain("Restore snapshot");
    expect(html).toContain("Delete snapshot");
    expect(html).toContain("Non-live-tree access");
    expect(html).toContain("Live tree mutation");
    expect(html).toContain("Snapshot storage mutation");
    expect(html).toContain("Snapshot manager");
    expect(html).toContain("src/snapshots.ts:20");
    expect(html).not.toContain("private-snapshot-id");
    expect(html).not.toContain("private-snapshot-ref");
  });

  it("is included in the Workspace definition detail", () => {
    const index = buildIndex(data);
    expect(indexSectionOrder(index.byId("workspace:scratch")!)).toContain(
      "workspaceSnapshots",
    );
  });
});
