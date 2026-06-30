import { afterEach, describe, expect, it } from "vitest";
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from "../../observability";
import { inMemoryDataStore } from "../../storage";
import { workspace } from "../../workspace";

describe("workspace version observability markers", () => {
  afterEach(() => resetObservabilityRuntime());

  it("emits exactly one version marker per content mutation, labelled by operation", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      data: inMemoryDataStore(),
    });

    await ws.write("/workspace/notes.md", "alpha"); // v1
    await ws.edit("/workspace/notes.md", { find: "alpha", replace: "beta" }); // v2 (wraps a nested write span)
    await ws.append("/workspace/notes.md", "!"); // v3
    await ws.undo("/workspace/notes.md"); // v4 (wraps a nested write span)
    await observe.flush();

    const markers = transport.records.filter(
      (record) =>
        record.type === "span:start" && record.name === "workspace.version",
    );

    // Exactly one marker per logical mutation — nested write spans never double-count.
    expect(markers.map((m) => m.attributes?.version)).toEqual([1, 2, 3, 4]);
    expect(markers.map((m) => m.attributes?.operation)).toEqual([
      "write",
      "edit",
      "append",
      "undo",
    ]);
    // Privacy-safe: the raw path is never emitted, only a hash.
    for (const marker of markers) {
      expect(marker.attributes?.pathHash).toMatch(/^fnv1a:/);
      expect(JSON.stringify(marker.attributes)).not.toContain("notes.md");
    }
  });
});
