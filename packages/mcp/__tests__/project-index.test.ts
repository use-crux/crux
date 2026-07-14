import { resetHooks, setHooks } from "@use-crux/core";
import type { ProjectIndexRuntimeUpdate } from "@use-crux/core/project-index/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { materializeMcpToolSource, mcp, streamableHttp } from "../src/index";
import {
  startMcpHttpFixture,
  type McpHttpFixture,
} from "./fixtures/http-server";

const fixtures: McpHttpFixture[] = [];

afterEach(async () => {
  resetHooks();
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.close()));
});

describe("MCP Project Index runtime updates", () => {
  it("enqueues one complete replacement after successful discovery", async () => {
    const fixture = await startMcpHttpFixture({
      pages: [
        {
          tools: [
            {
              name: "lookup",
              description: "Look up a catalog entry.",
              inputSchema: {
                type: "object",
                properties: { query: { type: "string" } },
              },
              annotations: { readOnlyHint: true },
            },
          ],
        },
      ],
    });
    fixtures.push(fixture);
    const updates: ProjectIndexRuntimeUpdate[] = [];
    setHooks({
      projectIndexRuntimeTransport: {
        enqueue(update) {
          updates.push(update);
        },
        async flush() {
          return "ok";
        },
      },
    });

    const session = await materializeMcpToolSource(
      mcp({
        id: "catalog",
        transport: streamableHttp({ url: fixture.url }),
        tools: { prefix: "remote_" },
      }),
      { runtimeContext: undefined },
    );

    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      schemaVersion: 1,
      operation: "replace",
      owner: { definitionId: "mcp.server:catalog", kind: "mcp.server" },
      revision: session.discovery.toolListFingerprint,
      definitions: [
        {
          id: "tool:remote_lookup",
          kind: "tool",
          name: "remote_lookup",
          description: "Look up a catalog entry.",
          status: "active",
          metadata: {
            inputSchema: {
              type: "object",
              properties: { query: { type: "string" } },
            },
            facts: {
              kind: "tool",
              toolName: "remote_lookup",
              mcp: {
                serverId: "catalog",
                remoteName: "lookup",
                exposedName: "remote_lookup",
                provenance: "runtime-discovered",
              },
            },
          },
        },
      ],
      relations: [
        {
          type: "mcp.server.provides_tool",
          from: "mcp.server:catalog",
          to: "tool:remote_lookup",
        },
      ],
    });
    await session.close();
  });

  it("enqueues a classified failure without partial children", async () => {
    const fixture = await startMcpHttpFixture({
      pages: [
        { tools: [], nextCursor: "same" },
        { cursor: "same", tools: [], nextCursor: "same" },
      ],
    });
    fixtures.push(fixture);
    const updates: ProjectIndexRuntimeUpdate[] = [];
    setHooks({
      projectIndexRuntimeTransport: {
        enqueue(update) {
          updates.push(update);
        },
        async flush() {
          return "ok";
        },
      },
    });

    await expect(
      materializeMcpToolSource(
        mcp({
          id: "catalog",
          transport: streamableHttp({ url: fixture.url }),
        }),
        { runtimeContext: undefined },
      ),
    ).rejects.toThrow("cursor loop");

    expect(updates).toEqual([
      expect.objectContaining({
        schemaVersion: 1,
        operation: "failure",
        owner: { definitionId: "mcp.server:catalog", kind: "mcp.server" },
        error: { phase: "discover", category: "mcp-discovery" },
      }),
    ]);
    expect(updates[0]).not.toHaveProperty("definitions");
    expect(updates[0]).not.toHaveProperty("relations");
  });
});
