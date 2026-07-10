import { describe, expect, it, vi } from "vitest";
import { inMemoryRecordStore } from "../../src/storage";
import { workspace } from "../../src/workspace";

describe("workspace() operator limits", () => {
  it("passes retention TTL to stores that support it and omits it for stores that do not", async () => {
    const ttlStore = inMemoryRecordStore();
    const ttlSet = vi.spyOn(ttlStore, "put");
    const expiring = workspace({
      id: "research",
      namespace: "thread:1",
      records: ttlStore,
      retention: { ttlMs: 1_000 },
    });

    await expiring.write("/workspace/notes.md", "notes");

    expect(ttlSet).toHaveBeenCalledWith(
      expect.stringContaining("workspace%2Fnotes.md"),
      expect.objectContaining({ path: "/workspace/notes.md" }),
      { ttlMs: 1_000 },
    );

    const nonTtlStore = inMemoryRecordStore();
    const nonTtlSet = vi.spyOn(nonTtlStore, "put");
    const nonExpiring = workspace({
      id: "research",
      namespace: "thread:2",
      records: {
        get: nonTtlStore.get,
        put: nonTtlStore.put,
        delete: nonTtlStore.delete,
        list: nonTtlStore.list,
        capabilities: () => ({ ...nonTtlStore.capabilities(), ttl: false }),
      },
      retention: { ttlMs: 1_000 },
    });

    await expect(
      nonExpiring.write("/workspace/notes.md", "notes"),
    ).resolves.toMatchObject({
      path: "/workspace/notes.md",
    });
    expect(nonTtlSet).toHaveBeenCalledWith(
      expect.stringContaining("workspace%2Fnotes.md"),
      expect.objectContaining({ path: "/workspace/notes.md" }),
      undefined,
    );
  });

  it("rejects a single file above maxFileBytes before writing to the store", async () => {
    const data = inMemoryRecordStore();
    const set = vi.spyOn(data, "put");
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: data,
      limits: { maxFileBytes: 4 },
    });

    await expect(ws.write("/workspace/notes.md", "12345")).rejects.toThrow(
      /maxFileBytes/,
    );

    expect(set).not.toHaveBeenCalled();
  });

  it("allows writes under maxNamespaceBytes and rejects the write that would exceed it", async () => {
    const data = inMemoryRecordStore();
    const set = vi.spyOn(data, "put");
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: data,
      limits: { maxNamespaceBytes: 10 },
    });

    await expect(ws.write("/workspace/a.txt", "1234")).resolves.toMatchObject({
      size: 4,
    });
    await expect(ws.write("/workspace/b.txt", "12345")).resolves.toMatchObject({
      size: 5,
    });
    await expect(ws.write("/workspace/c.txt", "12")).rejects.toThrow(
      /maxNamespaceBytes/,
    );

    // The rejected write persists nothing; the two accepted files each persist
    // a HEAD record plus a version snapshot.
    expect(set).toHaveBeenCalledTimes(4);
    expect(await ws.exists("/workspace/c.txt")).toBe(false);
  });

  it("serializes concurrent namespace quota checks with the write", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
      limits: { maxNamespaceBytes: 5 },
    });

    const results = await Promise.allSettled([
      ws.write("/workspace/a.txt", "1234"),
      ws.write("/workspace/b.txt", "5678"),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
  });

  it("applies retention and limits to filesystem mutations", async () => {
    const data = inMemoryRecordStore();
    const set = vi.spyOn(data, "put");
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: data,
      retention: { ttlMs: 1_000 },
      limits: { maxFileBytes: 8, maxNamespaceBytes: 20 },
    });

    await ws.append("/workspace/a.txt", "1234");
    await expect(ws.append("/workspace/a.txt", "56789")).rejects.toThrow(
      /maxFileBytes/,
    );
    await ws.copy("/workspace/a.txt", "/workspace/b.txt");
    await ws.rename("/workspace/b.txt", "/workspace/c.txt");
    await ws.finalize("/workspace/c.txt");

    expect(set).toHaveBeenCalledWith(
      expect.stringContaining("workspace%2Fa.txt"),
      expect.objectContaining({ path: "/workspace/a.txt" }),
      { ttlMs: 1_000 },
    );
    expect(set).toHaveBeenCalledWith(
      expect.stringContaining("workspace%2Fc.txt"),
      expect.objectContaining({ path: "/workspace/c.txt", status: "final" }),
      { ttlMs: 1_000 },
    );
  });
});
