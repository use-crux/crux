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

describe("MCP JSON Schema", () => {
  it("rejects invalid dynamic input before tools/call", async () => {
    const fixture = await startMcpHttpFixture({
      pages: [
        {
          tools: [
            {
              name: "search",
              description: "Search the catalog",
              inputSchema: {
                type: "object",
                properties: { query: { type: "string", minLength: 1 } },
                required: ["query"],
                additionalProperties: false,
              },
            },
          ],
        },
      ],
      callTool: () => ({ content: [{ type: "text", text: "called" }] }),
    });
    fixtures.push(fixture);
    const session = await materializeMcpToolSource(
      mcp({
        id: "catalog",
        transport: streamableHttp({ url: fixture.url }),
      }),
      { runtimeContext: undefined },
    );
    const search = session.tools.search!;

    await expect(
      search.execute(
        { query: 42 },
        {
          toolCallId: "call-invalid",
          runtimeContext: undefined,
        },
      ),
    ).rejects.toThrow();
    expect(fixture.toolCalls).toEqual([]);

    await session.close();
  });

  it("rejects structured content that violates the advertised output schema", async () => {
    const fixture = await startMcpHttpFixture({
      pages: [
        {
          tools: [
            {
              name: "count",
              inputSchema: { type: "object" },
              outputSchema: {
                type: "object",
                properties: { count: { type: "integer" } },
                required: ["count"],
                additionalProperties: false,
              },
            },
          ],
        },
      ],
      callTool: () => ({
        content: [{ type: "text", text: "invalid count" }],
        structuredContent: { count: "not-a-number" },
      }),
    });
    fixtures.push(fixture);
    const session = await materializeMcpToolSource(
      mcp({
        id: "catalog",
        transport: streamableHttp({ url: fixture.url }),
      }),
      { runtimeContext: undefined },
    );

    await expect(
      session.tools.count!.execute(
        {},
        { toolCallId: "call-output", runtimeContext: undefined },
      ),
    ).rejects.toThrow(/structured content/i);
    expect(fixture.toolCalls).toHaveLength(1);

    await session.close();
  });

  it("retains output validators from earlier discovery pages", async () => {
    const fixture = await startMcpHttpFixture({
      pages: [
        {
          tools: [
            {
              name: "first_page",
              inputSchema: { type: "object" },
              outputSchema: {
                type: "object",
                properties: { count: { type: "number" } },
                required: ["count"],
              },
            },
          ],
          nextCursor: "page-2",
        },
        {
          cursor: "page-2",
          tools: [{ name: "second_page", inputSchema: { type: "object" } }],
        },
      ],
      callTool: () => ({
        content: [],
        structuredContent: { count: "not-a-number" },
      }),
    });
    fixtures.push(fixture);
    const session = await materializeMcpToolSource(
      mcp({
        id: "paginated-output-schema",
        transport: streamableHttp({ url: fixture.url }),
      }),
      { runtimeContext: undefined },
    );

    await expect(
      session.tools.first_page!.execute(
        {},
        { toolCallId: "call-1", messages: [], runtimeContext: undefined },
      ),
    ).rejects.toThrow(/output schema|structured content/i);
    await session.close();
  });
});
