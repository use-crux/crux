import { afterEach, describe, expect, it } from "vitest";

import { createStdioExampleSource } from "../examples/stdio";
import { createHttpExampleSource } from "../examples/streamable-http";
import { materializeMcpToolSource } from "../src";
import {
  startMcpHttpFixture,
  type McpHttpFixture,
} from "./fixtures/http-server";
import {
  createMcpStdioFixture,
  type McpStdioFixture,
} from "./fixtures/stdio-fixture";

const httpFixtures: McpHttpFixture[] = [];
const stdioFixtures: McpStdioFixture[] = [];

afterEach(async () => {
  await Promise.all(httpFixtures.splice(0).map((fixture) => fixture.close()));
  await Promise.all(
    stdioFixtures.splice(0).map((fixture) => fixture.dispose()),
  );
});

describe("executable MCP documentation examples", () => {
  it("connects, selects, prefixes, calls, and closes over Streamable HTTP", async () => {
    const fixture = await startMcpHttpFixture({
      pages: [
        {
          tools: [
            { name: "lookup", inputSchema: { type: "object" } },
            { name: "not_allowed", inputSchema: { type: "object" } },
          ],
        },
      ],
      callTool: ({ name }) => ({
        content: [{ type: "text", text: `called ${name}` }],
      }),
    });
    httpFixtures.push(fixture);

    const session = await materializeMcpToolSource(
      createHttpExampleSource(fixture.url),
      { runtimeContext: { mcpToken: "fixture-token" } },
    );
    const result = await session.tools.catalog_lookup!.execute(
      {},
      { toolCallId: "http-docs", runtimeContext: undefined },
    );
    await session.close();

    expect(Object.keys(session.tools)).toEqual(["catalog_lookup"]);
    expect(result).toEqual({
      content: [{ type: "text", text: "called lookup" }],
    });
    expect(fixture.requestHeaders).toContainEqual(
      expect.objectContaining({ authorization: "Bearer fixture-token" }),
    );
    expect(fixture.toolCalls).toEqual([{ name: "lookup", arguments: {} }]);
  });

  it("discovers, calls, and closes the documented spawned stdio source", async () => {
    const fixture = await createMcpStdioFixture({
      pages: [
        {
          tools: [{ name: "read_file", inputSchema: { type: "object" } }],
        },
      ],
      callResult: { content: [{ type: "text", text: "from stdio" }] },
    });
    stdioFixtures.push(fixture);

    const session = await materializeMcpToolSource(
      createStdioExampleSource(fixture.transport),
      { runtimeContext: undefined },
    );
    const result = await session.tools.files_read_file!.execute(
      {},
      { toolCallId: "stdio-docs", runtimeContext: undefined },
    );
    await session.close();
    await fixture.waitForEvent("exit");

    expect(result).toEqual({
      content: [{ type: "text", text: "from stdio" }],
    });
    expect(await fixture.events()).toEqual([
      expect.objectContaining({ type: "started" }),
      { type: "list" },
      { type: "call", name: "read_file", arguments: {} },
      { type: "exit" },
    ]);
  });
});
