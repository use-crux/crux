import { afterEach, describe, expect, it } from "vitest";

import { materializeMcpToolSource, mcp, streamableHttp } from "../src/index";
import {
  startMcpHttpFixture,
  type McpHttpFixture,
} from "./fixtures/http-server";

const fixtures: McpHttpFixture[] = [];

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.close()));
});

describe("official MCP HTTP materializer", () => {
  it("discovers bounded pages and selects before deterministic prefixing", async () => {
    const pages = [
      {
        tools: [
          tool(
            "zeta",
            {
              type: "object",
              properties: { query: { type: "string" } },
              required: ["query"],
            },
            {
              readOnlyHint: true,
              destructiveHint: false,
            },
          ),
          tool("unreviewed", { type: "object" }),
        ],
        nextCursor: "page-2",
      },
      {
        cursor: "page-2",
        tools: [tool("alpha", { properties: {}, type: "object" })],
      },
    ] as const;
    const fixture = await startMcpHttpFixture({ pages });
    const repeatedFixture = await startMcpHttpFixture({ pages });
    fixtures.push(fixture, repeatedFixture);

    const source = mcp({
      id: "catalog",
      transport: streamableHttp({ url: fixture.url }),
      tools: { allow: ["zeta", "alpha"], prefix: "remote_" },
    });

    const first = await materializeMcpToolSource(source, {
      runtimeContext: undefined,
    });
    const repeated = await materializeMcpToolSource(
      mcp({
        id: "catalog",
        transport: streamableHttp({ url: repeatedFixture.url }),
        tools: { allow: ["zeta", "alpha"], prefix: "remote_" },
      }),
      {
        runtimeContext: undefined,
      },
    );

    expect(Object.keys(first.tools)).toEqual(["remote_alpha", "remote_zeta"]);
    expect(first.tools).not.toHaveProperty("remote_unreviewed");
    expect(fixture.requestedCursors).toEqual([undefined, "page-2"]);
    expect(repeatedFixture.requestedCursors).toEqual([undefined, "page-2"]);

    expect(first.discovery).toEqual(repeated.discovery);
    expect(first.discovery.toolListFingerprint).toMatch(
      /^sha256:[0-9a-f]{64}$/,
    );
    expect(first.tools.remote_alpha?.mcp).toMatchObject({
      serverId: "catalog",
      remoteName: "alpha",
      exposedName: "remote_alpha",
      toolListFingerprint: first.discovery.toolListFingerprint,
    });
    expect(first.tools.remote_zeta?.mcp.inputSchemaFingerprint).toMatch(
      /^sha256:[0-9a-f]{64}$/,
    );
    expect(first.tools.remote_zeta?.mcp).toMatchObject({
      annotations: { readOnlyHint: true, destructiveHint: false },
    });
    expect(
      Object.isFrozen(Reflect.get(first.tools.remote_zeta!.mcp, "annotations")),
    ).toBe(true);

    await repeated.close();
    await first.close();
  });

  it("rejects a repeated pagination cursor", async () => {
    const fixture = await startMcpHttpFixture({
      pages: [
        { tools: [], nextCursor: "same" },
        { cursor: "same", tools: [], nextCursor: "same" },
      ],
    });
    fixtures.push(fixture);

    await expect(
      materializeMcpToolSource(
        mcp({
          id: "looping",
          transport: streamableHttp({ url: fixture.url }),
        }),
        {
          runtimeContext: undefined,
        },
      ),
    ).rejects.toMatchObject({
      name: "McpToolSourceError",
      phase: "discover",
      serverId: "looping",
    });
  });

  it("rejects discovery beyond the finite page limit", async () => {
    const fixture = await startMcpHttpFixture({
      pages: Array.from({ length: 65 }, (_, index) => ({
        ...(index === 0 ? {} : { cursor: `page-${index}` }),
        tools: [],
        ...(index === 64 ? {} : { nextCursor: `page-${index + 1}` }),
      })),
    });
    fixtures.push(fixture);

    await expect(
      materializeMcpToolSource(
        mcp({
          id: "unbounded",
          transport: streamableHttp({ url: fixture.url }),
        }),
        { runtimeContext: undefined },
      ),
    ).rejects.toThrow("MCP tools/list exceeded the 64-page discovery limit.");
  });

  it("does not fabricate metadata for missing allowlist entries", async () => {
    const fixture = await startMcpHttpFixture({
      pages: [
        {
          tools: [tool("present", { type: "object" })],
        },
      ],
    });
    fixtures.push(fixture);

    const session = await materializeMcpToolSource(
      mcp({
        id: "partial-catalog",
        transport: streamableHttp({ url: fixture.url }),
        tools: { allow: ["present", "missing"], prefix: "remote_" },
      }),
      { runtimeContext: undefined },
    );

    expect(Object.keys(session.tools)).toEqual(["remote_present"]);
    expect(session.discovery.tools).toHaveLength(1);
    expect(session.discovery.tools[0]).toMatchObject({
      remoteName: "present",
      exposedName: "remote_present",
    });
    expect(JSON.stringify(session.discovery)).not.toContain("missing");
    await session.close();
  });

  it("discovers and executes the portable name __proto__ as an own tool", async () => {
    const calls: string[] = [];
    const fixture = await startMcpHttpFixture({
      pages: [{ tools: [tool("__proto__", { type: "object" })] }],
      callTool: ({ name }) => {
        calls.push(name);
        return { content: [{ type: "text", text: "ok" }] };
      },
    });
    fixtures.push(fixture);

    const session = await materializeMcpToolSource(
      mcp({
        id: "prototype-tool",
        transport: streamableHttp({ url: fixture.url }),
      }),
      { runtimeContext: undefined },
    );

    expect(Object.keys(session.tools)).toEqual(["__proto__"]);
    expect(Object.hasOwn(session.tools, "__proto__")).toBe(true);
    await session.tools.__proto__!.execute(
      {},
      { toolCallId: "call-1", messages: [], runtimeContext: undefined },
    );
    expect(calls).toEqual(["__proto__"]);
    await session.close();
  });
});

function tool(
  name: string,
  inputSchema: Record<string, unknown>,
  annotations?: {
    readonly readOnlyHint?: boolean;
    readonly destructiveHint?: boolean;
  },
) {
  return {
    name,
    description: `${name} description`,
    inputSchema: { type: "object" as const, ...inputSchema },
    ...(annotations ? { annotations } : {}),
  };
}
