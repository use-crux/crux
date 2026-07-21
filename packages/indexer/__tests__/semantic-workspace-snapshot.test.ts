import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { semanticIndexFacts } from "../src/indexer/semantic";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Workspace snapshot semantic relations", () => {
  it("retains each grouped-facet operation on the resolved Workspace", async () => {
    const root = await mkdtemp(join(process.cwd(), ".tmp-snapshot-semantic-"));
    const sourceFile = join(root, "src/index.ts");
    roots.push(root);
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(
      sourceFile,
      [
        "import { tool, workspace } from '@use-crux/core'",
        "",
        "export const scratch = workspace({ id: 'scratch' })",
        "",
        "export const snapshotTool = tool({",
        "  name: 'snapshotTool',",
        "  execute: async () => {",
        "    await scratch.snapshot.create({ path: '/drafts' })",
        "    await scratch.snapshot.list({ path: '/drafts' })",
        "    await scratch.snapshot.restore({ workspaceId: 'scratch' } as never)",
        "    await scratch.snapshot.delete({ workspaceId: 'scratch' } as never)",
        "  },",
        "})",
      ].join("\n"),
    );

    const facts = semanticIndexFacts(root, [sourceFile]);
    const relations = (facts.relations ?? []).filter(
      (relation) => relation.to === "workspace:scratch",
    );

    expect(relations).toEqual([
      expect.objectContaining({
        type: "tool.creates_workspace_snapshot",
        from: "tool:snapshotTool",
        source: expect.objectContaining({ file: sourceFile, line: 8 }),
        metadata: {
          workspaceSnapshot: {
            operation: "snapshot.create",
            effect: "snapshot-access",
          },
        },
      }),
      expect.objectContaining({
        type: "tool.lists_workspace_snapshots",
        from: "tool:snapshotTool",
        source: expect.objectContaining({ file: sourceFile, line: 9 }),
        metadata: {
          workspaceSnapshot: {
            operation: "snapshot.list",
            effect: "snapshot-access",
          },
        },
      }),
      expect.objectContaining({
        type: "tool.restores_workspace_snapshot",
        from: "tool:snapshotTool",
        source: expect.objectContaining({ file: sourceFile, line: 10 }),
        metadata: {
          workspaceSnapshot: {
            operation: "snapshot.restore",
            effect: "live-tree-mutation",
          },
        },
      }),
      expect.objectContaining({
        type: "tool.deletes_workspace_snapshot",
        from: "tool:snapshotTool",
        source: expect.objectContaining({ file: sourceFile, line: 11 }),
        metadata: {
          workspaceSnapshot: {
            operation: "snapshot.delete",
            effect: "snapshot-storage-mutation",
          },
        },
      }),
    ]);
    expect(
      (facts.definitions ?? []).some((definition) =>
        definition.id.startsWith("workspace.snapshot:"),
      ),
    ).toBe(false);
    expect(JSON.stringify(facts)).not.toContain("workspace.snapshot:");
  });
});
