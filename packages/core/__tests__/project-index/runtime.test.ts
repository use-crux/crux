import { describe, expect, it, vi } from "vitest";

import {
  ProjectIndexRuntimeUpdateSchema,
  createProjectIndexRuntimeTransport,
  type ProjectIndexRuntimeUpdate,
} from "../../src/project-index/runtime";

function replacement(
  updateId: string,
  owner = "mcp.server:catalog",
): ProjectIndexRuntimeUpdate {
  return {
    schemaVersion: 1,
    operation: "replace",
    updateId,
    owner: { definitionId: owner, kind: "mcp.server" },
    observedAt: "2026-07-14T10:00:00Z",
    revision: updateId,
    ownerFacts: {
      kind: "mcp.discovery",
      implementation: "official-client",
    },
    definitions: [],
    relations: [],
  };
}

describe("Project Index runtime update transport", () => {
  it("serializes non-blocking delivery and flushes the queued owner updates", async () => {
    let releaseFirst!: () => void;
    const firstDelivery = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const delivered: string[] = [];
    const deliver = vi.fn(async (update: ProjectIndexRuntimeUpdate) => {
      delivered.push(update.updateId);
      if (update.updateId === "update-1") await firstDelivery;
    });
    const transport = createProjectIndexRuntimeTransport({ deliver });

    expect(transport.enqueue(replacement("update-1"))).toBeUndefined();
    expect(transport.enqueue(replacement("update-2"))).toBeUndefined();
    await Promise.resolve();

    expect(delivered).toEqual(["update-1"]);
    releaseFirst();
    await expect(transport.flush({ timeoutMs: 100 })).resolves.toBe("ok");
    expect(delivered).toEqual(["update-1", "update-2"]);
    expect(
      ProjectIndexRuntimeUpdateSchema.parse(replacement("update-2")),
    ).toEqual(replacement("update-2"));
    expect(
      ProjectIndexRuntimeUpdateSchema.safeParse({
        schemaVersion: 1,
        operation: "failure",
        updateId: "partial-failure",
        owner: { definitionId: "mcp.server:catalog", kind: "mcp.server" },
        observedAt: "2026-07-14T10:00:00Z",
        error: { phase: "discover", category: "mcp-discovery" },
        definitions: [],
      }).success,
    ).toBe(false);
    const { ownerFacts: _ownerFacts, ...missingOwnerFacts } = replacement(
      "missing-owner-facts",
    );
    expect(
      ProjectIndexRuntimeUpdateSchema.safeParse(missingOwnerFacts).success,
    ).toBe(false);
    expect(
      ProjectIndexRuntimeUpdateSchema.safeParse({
        schemaVersion: 1,
        operation: "failure",
        updateId: "failure-with-owner-facts",
        owner: { definitionId: "mcp.server:catalog", kind: "mcp.server" },
        observedAt: "2026-07-14T10:00:00Z",
        error: { phase: "discover", category: "mcp-discovery" },
        ownerFacts: replacement("unused").ownerFacts,
      }).success,
    ).toBe(false);
    expect(
      ProjectIndexRuntimeUpdateSchema.safeParse({
        ...replacement("invalid-owner-facts"),
        ownerFacts: {
          kind: "mcp.discovery",
          implementation: "official-client",
          protocolVersion: "bad\u0000version",
        },
      }).success,
    ).toBe(false);
  });

  it("isolates delivery queues by owner and survives error reporters", async () => {
    let releaseCatalog!: () => void;
    const catalogDelivery = new Promise<void>((resolve) => {
      releaseCatalog = resolve;
    });
    const delivered: string[] = [];
    const transport = createProjectIndexRuntimeTransport({
      async deliver(update) {
        delivered.push(update.updateId);
        if (update.updateId === "catalog-1") await catalogDelivery;
        if (update.updateId === "orders-1")
          throw new Error("local unavailable");
      },
      onDeliveryError() {
        throw new Error("diagnostic reporter failed");
      },
    });

    transport.enqueue(replacement("catalog-1"));
    transport.enqueue(replacement("catalog-2"));
    transport.enqueue(replacement("orders-1", "mcp.server:orders"));
    transport.enqueue(replacement("orders-2", "mcp.server:orders"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(delivered).toEqual(["catalog-1", "orders-1", "orders-2"]);
    releaseCatalog();
    await expect(transport.flush({ timeoutMs: 100 })).resolves.toBe("ok");
    expect(delivered).toEqual([
      "catalog-1",
      "orders-1",
      "orders-2",
      "catalog-2",
    ]);
  });
});
