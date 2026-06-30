import { describe, expect, it, vi } from "vitest";
import { inMemoryDataStore } from "../../storage";
import { workspace } from "../../workspace";

describe("workspace() operator limits", () => {
  it("passes retention TTL to stores that support it and omits it for stores that do not", async () => {
    const ttlStore = inMemoryDataStore();
    const ttlSet = vi.spyOn(ttlStore, "set");
    const expiring = workspace({
      id: "research",
      namespace: "thread:1",
      data: ttlStore,
      retention: { ttlMs: 1_000 },
    });

    await expiring.write("/workspace/notes.md", "notes");

    expect(ttlSet).toHaveBeenCalledWith(
      expect.stringContaining("workspace%2Fnotes.md"),
      expect.objectContaining({ path: "/workspace/notes.md" }),
      { ttl: 1_000 },
    );

    const nonTtlStore = inMemoryDataStore();
    const nonTtlSet = vi.spyOn(nonTtlStore, "set");
    const nonExpiring = workspace({
      id: "research",
      namespace: "thread:2",
      data: {
        get: nonTtlStore.get,
        set: nonTtlStore.set,
        delete: nonTtlStore.delete,
        list: nonTtlStore.list,
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
    const data = inMemoryDataStore();
    const set = vi.spyOn(data, "set");
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      data,
      limits: { maxFileBytes: 4 },
    });

    await expect(ws.write("/workspace/notes.md", "12345")).rejects.toThrow(
      /maxFileBytes/,
    );

    expect(set).not.toHaveBeenCalled();
  });

  it("allows writes under maxNamespaceBytes and rejects the write that would exceed it", async () => {
    const data = inMemoryDataStore();
    const set = vi.spyOn(data, "set");
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      data,
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

    expect(set).toHaveBeenCalledTimes(2);
  });

  it("serializes concurrent namespace quota checks with the write", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      data: inMemoryDataStore(),
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
    const data = inMemoryDataStore();
    const set = vi.spyOn(data, "set");
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      data,
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
      { ttl: 1_000 },
    );
    expect(set).toHaveBeenCalledWith(
      expect.stringContaining("workspace%2Fc.txt"),
      expect.objectContaining({ path: "/workspace/c.txt", status: "final" }),
      { ttl: 1_000 },
    );
  });
});
