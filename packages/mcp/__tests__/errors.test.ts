import { afterEach, describe, expect, it } from "vitest";

import {
  McpToolSourceError,
  materializeMcpToolSource,
  mcp,
  streamableHttp,
} from "../src/index";
import {
  startMcpHttpFixture,
  type McpHttpFixture,
} from "./fixtures/http-server";

const fixtures: McpHttpFixture[] = [];

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.close()));
});

describe("MCP errors", () => {
  it("fails closed on duplicate exposed names with structured source context", async () => {
    const fixture = await startMcpHttpFixture({
      pages: [
        {
          tools: [{ name: "search", inputSchema: { type: "object" } }],
          nextCursor: "next",
        },
        {
          cursor: "next",
          tools: [{ name: "search", inputSchema: { type: "object" } }],
        },
      ],
    });
    fixtures.push(fixture);

    await expect(
      materializeMcpToolSource(
        mcp({
          id: "duplicate-server",
          transport: streamableHttp({
            url: `${fixture.url}?token=duplicate-secret`,
            headers: { authorization: "Bearer header-secret" },
          }),
          tools: { prefix: "remote_" },
        }),
        { runtimeContext: undefined },
      ),
    ).rejects.toMatchObject({
      name: "McpToolSourceError",
      code: "MCP_TOOL_SOURCE_ERROR",
      serverId: "duplicate-server",
      phase: "filter",
      transportKind: "streamable-http",
      endpoint: fixture.url,
    });
  });

  it("attributes unsupported remote schemas to the schema phase", async () => {
    const fixture = await startMcpHttpFixture({
      pages: [
        {
          tools: [
            {
              name: "conditional",
              inputSchema: {
                type: "object",
                if: { required: ["enabled"] },
                then: { required: ["value"] },
              },
            },
          ],
        },
      ],
    });
    fixtures.push(fixture);

    await expect(
      materializeMcpToolSource(
        mcp({
          id: "unsupported-schema",
          transport: streamableHttp({ url: fixture.url }),
        }),
        { runtimeContext: undefined },
      ),
    ).rejects.toMatchObject({
      name: "McpToolSourceError",
      code: "MCP_TOOL_SOURCE_ERROR",
      serverId: "unsupported-schema",
      phase: "schema",
    });
  });

  it("attributes malformed discovery pages without leaking protocol details", async () => {
    const fixture = await startMcpHttpFixture({
      pages: [{ tools: [] }],
      unsafeListToolsResult: () => ({ tools: "not-an-array" }),
    });
    fixtures.push(fixture);

    await expect(
      materializeMcpToolSource(
        mcp({
          id: "malformed-page",
          transport: streamableHttp({ url: fixture.url }),
        }),
        { runtimeContext: undefined },
      ),
    ).rejects.toMatchObject({
      name: "McpToolSourceError",
      serverId: "malformed-page",
      phase: "discover",
    });
  });

  it("redacts secrets from transport resolver failures", async () => {
    const failure = materializeMcpToolSource(
      mcp({
        id: "secret-server",
        transport: async () => {
          throw new Error(
            "Authorization: Bearer super-secret https://user:password@example.test/mcp?token=query-secret",
          );
        },
      }),
      { runtimeContext: undefined },
    );

    const error = await failure.catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(McpToolSourceError);
    expect(error).toMatchObject({
      serverId: "secret-server",
      phase: "transport-configuration",
    });
    const visible = `${String(error)}\n${String((error as Error).cause)}`;
    expect(visible).not.toContain("super-secret");
    expect(visible).not.toContain("password");
    expect(visible).not.toContain("query-secret");
  });

  it("never exposes opaque resolver values in the public error or cause", async () => {
    const opaqueSecret = "violet-umbrella-9281";
    const error = await materializeMcpToolSource(
      mcp({
        id: "opaque-resolver-failure",
        transport: async () => {
          throw new Error(`dependency rejected ${opaqueSecret}`);
        },
      }),
      { runtimeContext: undefined },
    ).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(McpToolSourceError);
    expect(error).toMatchObject({
      phase: "transport-configuration",
      serverId: "opaque-resolver-failure",
    });
    expect(`${String(error)}\n${String((error as Error).cause)}`).not.toContain(
      opaqueSecret,
    );
  });

  it("validates widened resolver results before transport construction", async () => {
    const opaqueSecret = "resolver-payload-4817";
    const error = await materializeMcpToolSource(
      mcp({
        id: "invalid-resolver-result",
        transport: async () =>
          ({ type: "websocket", detail: opaqueSecret }) as never,
      }),
      { runtimeContext: undefined },
    ).catch((cause: unknown) => cause);

    expect(error).toMatchObject({
      name: "McpToolSourceError",
      phase: "transport-configuration",
      serverId: "invalid-resolver-result",
    });
    expect(`${String(error)}\n${String((error as Error).cause)}`).not.toContain(
      opaqueSecret,
    );
  });

  it("throws transport and protocol call failures through ordinary tool handling", async () => {
    const fixture = await startMcpHttpFixture({
      pages: [
        { tools: [{ name: "explode", inputSchema: { type: "object" } }] },
      ],
      callTool: () => {
        throw new Error("remote call failed");
      },
    });
    fixtures.push(fixture);
    const session = await materializeMcpToolSource(
      mcp({
        id: "call-failure",
        transport: streamableHttp({ url: fixture.url }),
      }),
      { runtimeContext: undefined },
    );

    const call = session.tools.explode!.execute(
      {},
      { toolCallId: "call-1", messages: [], runtimeContext: undefined },
    );
    await expect(call).rejects.not.toBeInstanceOf(McpToolSourceError);
    await session.close();
  });

  it("rejects tools that require unsupported task-based execution", async () => {
    const fixture = await startMcpHttpFixture({
      pages: [
        {
          tools: [
            {
              name: "background_job",
              inputSchema: { type: "object" },
              execution: { taskSupport: "required" },
            },
          ],
        },
      ],
    });
    fixtures.push(fixture);

    await expect(
      materializeMcpToolSource(
        mcp({
          id: "task-required",
          transport: streamableHttp({ url: fixture.url }),
        }),
        { runtimeContext: undefined },
      ),
    ).rejects.toMatchObject({
      name: "McpToolSourceError",
      serverId: "task-required",
      phase: "discover",
    });
  });
});
