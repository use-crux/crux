import { afterEach, describe, expect, it } from "vitest";

import { materializeMcpToolSource, mcp, streamableHttp } from "../src/index";
import {
  startMcpHttpFixture,
  type McpHttpFixture,
  type McpHttpFixtureScenario,
} from "./fixtures/http-server";

const fixtures: McpHttpFixture[] = [];

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.close()));
});

describe("MCP result mapping", () => {
  it("preserves ordered text, image, and audio while hiding protocol metadata", async () => {
    const { session, tool: media } = await fixtureTool(
      {
        pages: [
          {
            tools: [{ name: "media", inputSchema: { type: "object" } }],
          },
        ],
        callTool: () => ({
          content: [
            { type: "text", text: "first", _meta: { secret: "hidden" } },
            {
              type: "image",
              data: "AQI=",
              mimeType: "image/png",
              _meta: { secret: "hidden" },
            },
            {
              type: "audio",
              data: "AwQ=",
              mimeType: "audio/wav",
              _meta: { secret: "hidden" },
            },
          ],
          _meta: { token: "never-visible" },
        }),
      },
      "multimodal",
      "media",
    );
    const input = {};
    const output = await media.execute(input, {
      toolCallId: "call-media",
      runtimeContext: undefined,
    });

    expect(output).toEqual({
      content: [
        { type: "text", text: "first" },
        { type: "image", data: "AQI=", mimeType: "image/png" },
        { type: "audio", data: "AwQ=", mimeType: "audio/wav" },
      ],
    });
    expect(
      await media.toModelOutput?.({
        toolCallId: "call-media",
        input,
        output,
      }),
    ).toEqual({
      type: "content",
      value: [
        { type: "text", text: "first" },
        {
          type: "image",
          source: new Uint8Array([1, 2]),
          mediaType: "image/png",
        },
        {
          type: "audio",
          source: new Uint8Array([3, 4]),
          mediaType: "audio/wav",
        },
      ],
    });

    await session.close();
  });

  it("maps attributed text, binary resources, and unfetched resource links", async () => {
    const { session, tool: resources } = await fixtureTool(
      {
        pages: [
          {
            tools: [{ name: "resources", inputSchema: { type: "object" } }],
          },
        ],
        callTool: () => ({
          content: [
            {
              type: "resource",
              resource: {
                uri: "https://example.test/manual.txt",
                text: "read me",
                mimeType: "text/plain",
                _meta: { token: "hidden" },
              },
            },
            {
              type: "resource",
              resource: {
                uri: "https://example.test/asset.bin",
                blob: "BQY=",
                mimeType: "application/octet-stream",
              },
            },
            {
              type: "resource_link",
              uri: "https://example.test/docs",
              name: "Docs",
              description: "Reference documentation",
              mimeType: "text/html",
              _meta: { token: "hidden" },
            },
          ],
        }),
      },
      "resources",
      "resources",
    );
    const output = await resources.execute(
      {},
      { toolCallId: "call-resources", runtimeContext: undefined },
    );

    expect(output).toEqual({
      content: [
        {
          type: "resource",
          resource: {
            uri: "https://example.test/manual.txt",
            text: "read me",
            mimeType: "text/plain",
          },
        },
        {
          type: "resource",
          resource: {
            uri: "https://example.test/asset.bin",
            blob: "BQY=",
            mimeType: "application/octet-stream",
          },
        },
        {
          type: "resource_link",
          uri: "https://example.test/docs",
          name: "Docs",
          description: "Reference documentation",
          mimeType: "text/html",
        },
      ],
    });
    expect(
      await resources.toModelOutput?.({
        toolCallId: "call-resources",
        input: {},
        output,
      }),
    ).toEqual({
      type: "content",
      value: [
        {
          type: "text",
          text: "Resource https://example.test/manual.txt:\nread me",
        },
        {
          type: "text",
          text: "Resource https://example.test/asset.bin:",
        },
        {
          type: "file",
          source: new Uint8Array([5, 6]),
          mediaType: "application/octet-stream",
          filename: "asset.bin",
        },
        {
          type: "text",
          text: "Resource link: Docs (https://example.test/docs) — Reference documentation",
        },
      ],
    });

    await session.close();
  });

  it("uses validated structured content when normal content is empty", async () => {
    const { session, tool: structured } = await fixtureTool(
      {
        pages: [
          {
            tools: [
              {
                name: "structured",
                inputSchema: { type: "object" },
                outputSchema: {
                  type: "object",
                  properties: { answer: { type: "string" } },
                  required: ["answer"],
                },
              },
            ],
          },
        ],
        callTool: () => ({
          content: [],
          structuredContent: { answer: "forty-two" },
          _meta: { token: "hidden" },
        }),
      },
      "structured",
      "structured",
    );
    const output = await structured.execute(
      {},
      { toolCallId: "call-structured", runtimeContext: undefined },
    );

    expect(output).toEqual({
      content: [],
      structuredContent: { answer: "forty-two" },
    });
    expect(
      await structured.toModelOutput?.({
        toolCallId: "call-structured",
        input: {},
        output,
      }),
    ).toEqual({
      type: "json",
      value: { answer: "forty-two" },
    });

    await session.close();
  });

  it("turns isError into a completed model-visible tool error", async () => {
    const { session, tool: failing } = await fixtureTool(
      {
        pages: [
          {
            tools: [{ name: "failing", inputSchema: { type: "object" } }],
          },
        ],
        callTool: () => ({
          content: [{ type: "text", text: "Remote validation failed" }],
          isError: true,
        }),
      },
      "errors",
      "failing",
    );
    const output = await failing.execute(
      {},
      { toolCallId: "call-error", runtimeContext: undefined },
    );

    expect(output).toEqual({
      content: [{ type: "text", text: "Remote validation failed" }],
      isError: true,
    });
    expect(
      await failing.toModelOutput?.({
        toolCallId: "call-error",
        input: {},
        output,
      }),
    ).toEqual({ type: "error-text", value: "Remote validation failed" });

    await session.close();
  });
});

async function fixtureTool(
  scenario: McpHttpFixtureScenario,
  serverId: string,
  toolName: string,
) {
  const fixture = await startMcpHttpFixture(scenario);
  fixtures.push(fixture);
  const session = await materializeMcpToolSource(
    mcp({
      id: serverId,
      transport: streamableHttp({ url: fixture.url }),
    }),
    { runtimeContext: undefined },
  );
  const tool = session.tools[toolName];
  if (!tool) throw new Error(`Fixture did not materialize ${toolName}.`);
  return { session, tool };
}
