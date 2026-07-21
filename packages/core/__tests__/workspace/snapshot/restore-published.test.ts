import { describe, expect, it } from "vitest";
import { inMemoryRecordStore } from "../../../src/storage";
import { workspace } from "../../../src/workspace";

describe("workspace snapshot published restore", () => {
  it("restores a published-only difference when working HEAD matches", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
    });
    await ws.write("/outputs/report.md", "published", { kind: "report" });
    await ws.finalize("/outputs/report.md");
    await ws.write("/outputs/report.md", "working");
    const snapshot = await ws.snapshot.create({ path: "/outputs/report.md" });
    await ws.finalize("/outputs/report.md");

    await expect(ws.snapshot.restore(snapshot)).resolves.toEqual({
      restoredFiles: 1,
      deletedFiles: 0,
      unchangedFiles: 0,
    });
    const [artifact] = await ws.artifacts({ status: "final" });
    expect(artifact).toBeDefined();
    await expect(
      ws.read("/outputs/report.md", { version: artifact?.version }),
    ).resolves.toMatchObject({ content: "published" });
    await expect(ws.read("/outputs/report.md")).resolves.toMatchObject({
      content: "working",
    });
  });

  it("remaps distinct published content to the first of two restore versions", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
      versioning: { maxVersions: 1 },
    });
    await ws.write("/outputs/report.md", "published", { kind: "report" });
    await ws.finalize("/outputs/report.md");
    await ws.write("/outputs/report.md", "working");
    const snapshot = await ws.snapshot.create({ path: "/outputs/report.md" });
    await ws.write("/outputs/report.md", "later");

    await expect(ws.snapshot.restore(snapshot)).resolves.toMatchObject({
      restoredFiles: 1,
    });
    await expect(ws.history("/outputs/report.md")).resolves.toMatchObject([
      { version: 5, operation: "restore" },
      { version: 4, operation: "restore" },
    ]);
    const [artifact] = await ws.artifacts({ status: "final" });
    expect(artifact?.version).toBe(4);
    await expect(
      ws.read("/outputs/report.md", { version: artifact?.version }),
    ).resolves.toMatchObject({ content: "published" });
    await expect(ws.read("/outputs/report.md")).resolves.toMatchObject({
      content: "working",
    });
  });

  it("pins equal published and HEAD content to one restore version", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
    });
    await ws.write("/outputs/report.md", "published", { kind: "report" });
    await ws.finalize("/outputs/report.md");
    const snapshot = await ws.snapshot.create({ path: "/outputs/report.md" });
    await ws.write("/outputs/report.md", "later");

    await expect(ws.snapshot.restore(snapshot)).resolves.toMatchObject({
      restoredFiles: 1,
    });
    await expect(ws.history("/outputs/report.md")).resolves.toMatchObject([
      { version: 3, operation: "restore" },
      { version: 2, operation: "write" },
      { version: 1, operation: "write" },
    ]);
    const [artifact] = await ws.artifacts({ status: "final" });
    expect(artifact?.version).toBe(3);
    await expect(ws.read("/outputs/report.md")).resolves.toMatchObject({
      content: "published",
    });
  });
});
