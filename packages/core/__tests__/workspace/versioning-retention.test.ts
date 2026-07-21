import { describe, expect, it } from "vitest";
import { inMemoryRecordStore } from "../../src/storage";
import { workspace } from "../../src/workspace";

describe("workspace version retention", () => {
  it("retains an active final pin beyond maxVersions", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
      versioning: { maxVersions: 1 },
    });

    await ws.write("/outputs/report.md", "published");
    await ws.finalize("/outputs/report.md", { kind: "report" });
    await ws.write("/outputs/report.md", "working copy");

    expect(
      (await ws.history("/outputs/report.md")).map((entry) => entry.version),
    ).toEqual([2, 1]);
    await expect(
      ws.read("/outputs/report.md", { version: 1 }),
    ).resolves.toMatchObject({ kind: "text", content: "published" });
    await expect(
      ws.artifacts({ path: "/outputs/report.md" }),
    ).resolves.toMatchObject([
      { status: "final", version: 1, preview: "published" },
    ]);
  });
});
