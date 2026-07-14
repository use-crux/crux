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

describe("MCP tool names", () => {
  it("rejects a non-portable final name before provider I/O", async () => {
    const fixture = await startMcpHttpFixture({
      pages: [
        { tools: [{ name: "search.v2", inputSchema: { type: "object" } }] },
      ],
    });
    fixtures.push(fixture);

    await expect(
      materializeMcpToolSource(
        mcp({
          id: "dotted-name",
          transport: streamableHttp({ url: fixture.url }),
        }),
        { runtimeContext: undefined },
      ),
    ).rejects.toMatchObject({
      name: "McpToolSourceError",
      serverId: "dotted-name",
      phase: "filter",
    });
  });

  it("rejects names outside the broader MCP grammar before prefixing", async () => {
    const fixture = await startMcpHttpFixture({
      pages: [
        { tools: [{ name: "bad/name", inputSchema: { type: "object" } }] },
      ],
    });
    fixtures.push(fixture);

    await expect(
      materializeMcpToolSource(
        mcp({
          id: "invalid-remote-name",
          transport: streamableHttp({ url: fixture.url }),
          tools: { prefix: "server_" },
        }),
        { runtimeContext: undefined },
      ),
    ).rejects.toThrow("Invalid remote MCP tool name");
  });

  it("accepts exactly 64 portable characters and rejects 65", async () => {
    const validName = `a${"b".repeat(63)}`;
    const invalidName = `a${"b".repeat(64)}`;
    const fixture = await startMcpHttpFixture({
      pages: [
        {
          tools: [
            { name: validName, inputSchema: { type: "object" } },
            { name: invalidName, inputSchema: { type: "object" } },
          ],
        },
      ],
    });
    fixtures.push(fixture);

    const validSession = await materializeMcpToolSource(
      mcp({
        id: "name-length",
        transport: streamableHttp({ url: fixture.url }),
        tools: { allow: [validName] },
      }),
      { runtimeContext: undefined },
    );
    expect(validSession.tools).toMatchObject({
      [validName]: expect.any(Object),
    });
    await validSession.close();

    const rejectedFixture = await startMcpHttpFixture({
      pages: [
        { tools: [{ name: invalidName, inputSchema: { type: "object" } }] },
      ],
    });
    fixtures.push(rejectedFixture);
    await expect(
      materializeMcpToolSource(
        mcp({
          id: "name-too-long",
          transport: streamableHttp({ url: rejectedFixture.url }),
        }),
        { runtimeContext: undefined },
      ),
    ).rejects.toMatchObject({ phase: "filter" });
  });

  it("repairs a leading digit with a prefix without changing tools/call", async () => {
    const fixture = await startMcpHttpFixture({
      pages: [
        { tools: [{ name: "1search", inputSchema: { type: "object" } }] },
      ],
      callTool: () => ({ content: [{ type: "text", text: "ok" }] }),
    });
    fixtures.push(fixture);
    const session = await materializeMcpToolSource(
      mcp({
        id: "prefixed-leading-digit",
        transport: streamableHttp({ url: fixture.url }),
        tools: { prefix: "server_" },
      }),
      { runtimeContext: undefined },
    );

    expect(session.tools.server_1search?.mcp).toMatchObject({
      remoteName: "1search",
      exposedName: "server_1search",
    });
    await session.tools.server_1search!.execute(
      {},
      { toolCallId: "call-1", messages: [], runtimeContext: undefined },
    );
    expect(fixture.toolCalls[0]?.name).toBe("1search");
    await session.close();
  });
});
