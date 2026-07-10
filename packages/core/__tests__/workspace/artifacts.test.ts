import { describe, expect, it, vi } from "vitest";
import { inMemoryBlobStore, inMemoryRecordStore, storage } from "../../src/storage";
import { workspace } from "../../src/workspace";
import { observe } from "../../src/observability";
import { prompt } from "../../src/prompt";

describe("workspace artifacts facet", () => {
  it("writes artifact status and kind metadata visible through stat and read", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:default",
      records: inMemoryRecordStore(),
    });

    const written = await ws.write("/outputs/report.md", "# Report", {
      status: "draft",
      kind: "report",
      mimeType: "text/markdown",
    });

    expect(written).toMatchObject({
      path: "/outputs/report.md",
      status: "draft",
      artifactKind: "report",
    });
    await expect(ws.stat("/outputs/report.md")).resolves.toMatchObject({
      status: "draft",
      artifactKind: "report",
    });
    await expect(ws.read("/outputs/report.md")).resolves.toMatchObject({
      kind: "text",
      status: "draft",
      artifactKind: "report",
      content: "# Report",
    });
  });

  it("finalizes a draft file as an artifact", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:default",
      records: inMemoryRecordStore(),
    });

    await ws.write("/outputs/report.md", "# Report", {
      status: "draft",
      kind: "report",
      mimeType: "text/markdown",
    });

    const artifact = await ws.finalize("/outputs/report.md");

    expect(artifact).toMatchObject({
      path: "/outputs/report.md",
      status: "final",
      kind: "report",
      mimeType: "text/markdown",
      size: 8,
    });
    await expect(ws.stat("/outputs/report.md")).resolves.toMatchObject({
      status: "final",
      artifactKind: "report",
    });
  });

  it("preserves artifact metadata when rewriting content without artifact options", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:default",
      records: inMemoryRecordStore(),
    });

    await ws.write("/outputs/report.md", "# Report", {
      status: "draft",
      kind: "report",
    });
    await ws.finalize("/outputs/report.md");
    await ws.write("/outputs/report.md", "# Updated");

    await expect(ws.stat("/outputs/report.md")).resolves.toMatchObject({
      status: "final",
      artifactKind: "report",
    });
  });

  it("pins the finalized version so later edits do not move the published artifact", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:default",
      records: inMemoryRecordStore(),
    });

    await ws.write("/outputs/report.md", "published", {
      kind: "report",
      mimeType: "text/markdown",
    });
    const finalized = await ws.finalize("/outputs/report.md");
    expect(finalized).toMatchObject({ status: "final", version: 1, size: 9 });

    // The agent keeps iterating the working copy.
    await new Promise((resolve) => setTimeout(resolve, 1));
    await ws.edit("/outputs/report.md", {
      find: "published",
      replace: "work in progress draft",
    });

    // The published artifact still resolves to the pinned revision.
    const stat = await ws.stat("/outputs/report.md");
    const [artifact] = await ws.artifacts({ status: "final" });
    expect(artifact).toMatchObject({
      path: "/outputs/report.md",
      status: "final",
      version: 1,
      size: 9,
    });
    expect(artifact?.updatedAt).toBe(stat?.updatedAt);

    // read() is the working surface and reflects the edit.
    await expect(ws.read("/outputs/report.md")).resolves.toMatchObject({
      kind: "text",
      content: "work in progress draft",
    });
    // The pinned content is still retrievable at its version.
    await expect(
      ws.read("/outputs/report.md", { version: 1 }),
    ).resolves.toMatchObject({ kind: "text", content: "published" });
  });

  it("re-finalizing republishes the latest version", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:default",
      records: inMemoryRecordStore(),
    });

    await ws.write("/outputs/report.md", "v1 published", { kind: "report" });
    await ws.finalize("/outputs/report.md");
    await ws.edit("/outputs/report.md", {
      find: "v1 published",
      replace: "v2 ready",
    });
    const republished = await ws.finalize("/outputs/report.md");

    expect(republished).toMatchObject({ version: 2, size: 8 });
    const [artifact] = await ws.artifacts({ status: "final" });
    expect(artifact).toMatchObject({ version: 2, size: 8 });
  });

  it("queries artifacts by status and kind through store filters", async () => {
    const data = inMemoryRecordStore();
    const listSpy = vi.spyOn(data, "list");
    const ws = workspace({
      id: "research",
      namespace: "thread:default",
      records: data,
    });

    await ws.write("/outputs/draft.md", "Draft", {
      status: "draft",
      kind: "report",
    });
    await ws.write("/outputs/final.md", "Final", {
      status: "final",
      kind: "report",
    });
    await ws.write(
      "/outputs/chart.json",
      { points: [1, 2] },
      { status: "final", kind: "chart" },
    );
    await ws.write("/workspace/notes.md", "Not an artifact");

    const finalArtifacts = (await ws.artifacts({ status: "final" }))
      .map(({ kind, path, status }) => ({
        kind,
        path,
        status,
      }))
      .sort((left, right) => left.path.localeCompare(right.path));

    expect(finalArtifacts).toEqual([
      { path: "/outputs/chart.json", status: "final", kind: "chart" },
      { path: "/outputs/final.md", status: "final", kind: "report" },
    ]);
    await expect(ws.artifacts({ kind: "report" })).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "/outputs/final.md", kind: "report" }),
        expect.objectContaining({ path: "/outputs/draft.md", kind: "report" }),
      ]),
    );
    expect(listSpy).toHaveBeenCalledWith(expect.any(String), {
      filter: { status: "final" },
    });
    expect(listSpy).toHaveBeenCalledWith(expect.any(String), {
      filter: { kind: "report" },
    });
  });

  it("returns download references for blob and inline artifacts", async () => {
    const blobs = inMemoryBlobStore();
    const ws = workspace({
      id: "research",
      namespace: "thread:default",
      storage: storage({ records: inMemoryRecordStore(), blobs }),
    });

    await ws.write("/outputs/report.pdf", new Uint8Array([1, 2, 3]), {
      status: "draft",
      kind: "pdf",
      mimeType: "application/pdf",
    });
    await ws.write("/outputs/summary.md", "Summary", {
      status: "draft",
      kind: "summary",
      mimeType: "text/markdown",
    });

    const binary = await ws.finalize("/outputs/report.pdf");
    const inline = await ws.finalize("/outputs/summary.md");

    expect(binary.uri).toMatch(/^memory:\/\//);
    await expect(blobs.get(binary.uri ?? "")).resolves.toMatchObject({
      mimeType: "application/pdf",
      size: 3,
    });
    expect(inline.uri).toBe(
      "workspace-inline://research/thread%3Adefault/outputs/summary.md",
    );
  });

  it("records provenance from the caller observability context when present", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:default",
      records: inMemoryRecordStore(),
    });

    await ws.write("/outputs/no-span.md", "No span", {
      status: "draft",
      kind: "note",
    });
    await expect(ws.stat("/outputs/no-span.md")).resolves.not.toHaveProperty(
      "producedBy",
    );

    const run = observe.openRun({
      name: "artifact run",
      rootPrimitive: "custom.operation",
    });
    await run.withContext(async () => {
      await observe.span(
        { name: "producer", primitive: "custom.operation" },
        async () => {
          await ws.write("/outputs/with-span.md", "With span", {
            status: "draft",
            kind: "note",
          });
        },
      );
    });
    run.end();

    const produced = await ws.stat("/outputs/with-span.md");
    expect(produced?.producedBy).toMatchObject({
      runId: run.runId,
    });
    expect(produced?.producedBy?.spanId).toMatch(/^[0-9a-f]{16}$/);
  });

  it("surfaces final artifacts in the manifest without contents", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:default",
      records: inMemoryRecordStore(),
    });

    await ws.write("/outputs/report.md", "private report", {
      status: "draft",
      kind: "report",
    });
    await ws.finalize("/outputs/report.md");
    await ws.write("/outputs/wip.md", "private draft", {
      status: "draft",
      kind: "report",
    });

    const resolved = await prompt({
      id: "analyst",
      use: [ws],
      system: "Analyze.",
    }).resolve({});

    expect(resolved.system).toContain("Final artifacts:");
    expect(resolved.system).toContain(
      "/outputs/report.md (report, text/plain, 14 bytes)",
    );
    expect(resolved.system).not.toContain("/outputs/wip.md (report");
    expect(resolved.system).not.toContain("private report");
  });

  it("surfaces the pinned version in the manifest after later edits", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:default",
      records: inMemoryRecordStore(),
    });

    await ws.write("/outputs/report.md", "published copy", {
      kind: "report",
      mimeType: "text/markdown",
    });
    await ws.finalize("/outputs/report.md");
    await ws.edit("/outputs/report.md", {
      find: "published copy",
      replace: "a much longer work-in-progress draft body",
    });

    const resolved = await prompt({
      id: "analyst",
      use: [ws],
      system: "Analyze.",
    }).resolve({});

    // Manifest reflects the pinned 14-byte revision, not the longer working copy.
    expect(resolved.system).toContain(
      "/outputs/report.md (report, text/markdown, 14 bytes)",
    );
  });

  it("bounds final artifacts in the manifest", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:default",
      records: inMemoryRecordStore(),
    });

    for (let index = 0; index < 120; index += 1) {
      await ws.write(`/outputs/report-${index}.md`, "report", {
        status: "final",
        kind: "report",
      });
    }

    const resolved = await prompt({
      id: "analyst",
      use: [ws],
      system: "Analyze.",
    }).resolve({});

    const finalArtifactsSection =
      resolved.system.split("Final artifacts:")[1] ?? "";
    const artifactCount =
      finalArtifactsSection.match(/\/outputs\/report-/g)?.length ?? 0;
    expect(artifactCount).toBeLessThanOrEqual(100);
    expect(resolved.system).toContain("more final artifacts omitted");
  });
});
