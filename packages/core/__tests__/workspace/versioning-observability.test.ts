import { afterEach, describe, expect, it } from "vitest";
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from "../../src/observability";
import {
  inMemoryRecordStore,
  storage,
  type AssetStore,
  type StoredAsset,
} from "../../src/storage";
import { workspace } from "../../src/workspace";

describe("workspace version observability markers", () => {
  afterEach(() => resetObservabilityRuntime());

  it("emits exactly one version marker per content mutation, labelled by operation", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
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

  it("does not emit full workspace asset refs or delivery URIs", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      storage: storage({
        records: inMemoryRecordStore(),
        assets: privateRefAssetStore(),
      }),
      content: { inlineTextBelowBytes: 0 },
    });

    await ws.write("/outputs/report.md", "secret report", {
      status: "draft",
      kind: "report",
      mimeType: "text/markdown",
    });
    await ws.write("/outputs/chart.md", "secret chart", {
      status: "draft",
      kind: "chart",
      mimeType: "text/markdown",
    });
    await ws.write("/outputs/signed.md", "secret signed url", {
      status: "draft",
      kind: "signed",
      mimeType: "text/markdown",
    });
    await ws.read("/outputs/report.md");
    await ws.stat("/outputs/chart.md");
    await ws.finalize("/outputs/signed.md");
    await ws.artifacts();
    await observe.flush();

    const serialized = JSON.stringify(transport.records);
    expect(serialized).not.toContain("memory://");
    expect(serialized).not.toContain("convex://");
    expect(serialized).not.toContain("provider-file-secret");
    expect(serialized).not.toContain("signed-token-secret");
    expect(serialized).not.toContain("https://storage.example.com");
    expect(serialized).not.toContain("credential=secret");
  });
});

function privateRefAssetStore(): AssetStore {
  const stored = new Map<string, StoredAsset>();
  const uris = [
    "memory://asset/provider-file-secret?signed=signed-token-secret",
    "convex://asset/provider-file-secret?signed=signed-token-secret",
    "https://user:pass@storage.example.com/file/provider-file-secret?credential=secret&token=signed-token-secret",
  ] as const;
  let puts = 0;
  return Object.freeze({
    put: async (asset, options) => {
      const uri = uris[puts] ?? uris[uris.length - 1];
      puts += 1;
      const ref = { uri };
      const storedAsset: StoredAsset =
        asset.type === "data"
          ? {
              ...asset,
              ref,
              size: asset.size,
              data:
                asset.data instanceof Uint8Array
                  ? new Uint8Array(asset.data)
                  : asset.data,
            }
          : {
              type: "data",
              data: new Uint8Array(),
              mediaType:
                asset.mediaType ?? options?.metadata?.mediaType?.toString() ?? "application/octet-stream",
              size: 0,
              ref,
            };
      stored.set(uri, storedAsset);
      return storedAsset;
    },
    get: async (ref) => {
      const storedAsset = stored.get(ref.uri);
      if (!storedAsset) throw new Error("missing asset");
      return storedAsset;
    },
    delete: async (ref) => {
      stored.delete(ref.uri);
    },
  });
}
