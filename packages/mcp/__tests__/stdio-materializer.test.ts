import { afterEach, describe, expect, it } from "vitest";

import { materializeMcpToolSource, mcp } from "../src/index";
import {
  createMcpStdioFixture,
  type McpStdioFixture,
} from "./fixtures/stdio-fixture";

const fixtures: McpStdioFixture[] = [];

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.dispose()));
});

describe("official MCP stdio materializer", () => {
  it("discovers paginated tools, calls, and closes the spawned server process", async () => {
    const fixture = await createMcpStdioFixture({
      pages: [
        {
          tools: [{ name: "first", inputSchema: { type: "object" } }],
          nextCursor: "page-2",
        },
        {
          cursor: "page-2",
          tools: [{ name: "lookup", inputSchema: { type: "object" } }],
        },
      ],
      callResult: { content: [{ type: "text", text: "from stdio" }] },
    });
    fixtures.push(fixture);

    const session = await materializeMcpToolSource(
      mcp({ id: "stdio-fixture", transport: fixture.transport }),
      { runtimeContext: undefined },
    );
    const output = await session.tools.lookup!.execute(
      {},
      { toolCallId: "call-1", messages: [], runtimeContext: undefined },
    );
    await session.close();
    await fixture.waitForEvent("exit");

    expect(output).toEqual({
      content: [{ type: "text", text: "from stdio" }],
    });
    expect(await fixture.events()).toEqual([
      expect.objectContaining({ type: "started" }),
      { type: "list" },
      { type: "list", cursor: "page-2" },
      { type: "call", name: "lookup", arguments: {} },
      { type: "exit" },
    ]);
  });

  it("closes the spawned process when discovery fails", async () => {
    const fixture = await createMcpStdioFixture({ pages: [] });
    fixtures.push(fixture);

    await expect(
      materializeMcpToolSource(
        mcp({ id: "broken-stdio", transport: fixture.transport }),
        { runtimeContext: undefined },
      ),
    ).rejects.toMatchObject({ phase: "discover" });
    await fixture.waitForEvent("exit");

    expect(await fixture.events()).toEqual([
      expect.objectContaining({ type: "started" }),
      { type: "list" },
      { type: "exit" },
    ]);
  });
});
