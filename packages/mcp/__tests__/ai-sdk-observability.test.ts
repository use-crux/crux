import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from "@use-crux/core/observability";
import { afterEach, describe, expect, it } from "vitest";

import {
  materializeAiSdkMcpToolSource,
  mcp,
  streamableHttp,
} from "../src/index";
import {
  startMcpHttpFixture,
  type McpHttpFixture,
} from "./fixtures/http-server";

const fixtures: McpHttpFixture[] = [];

afterEach(async () => {
  resetObservabilityRuntime();
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.close()));
});

describe("AI SDK-native MCP observability", () => {
  it("identifies the native implementation and discovered contract", async () => {
    const fixture = await startMcpHttpFixture({
      pages: [
        {
          tools: [
            {
              name: "lookup",
              inputSchema: { type: "object", properties: {} },
            },
          ],
        },
      ],
    });
    fixtures.push(fixture);
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);

    await observe.run(
      { name: "native MCP", rootPrimitive: "run" },
      async () => {
        const session = await materializeAiSdkMcpToolSource(
          mcp({
            id: "native-catalog",
            transport: streamableHttp({ url: fixture.url }),
          }),
          { runtimeContext: undefined },
        );
        await session.close();
      },
    );
    await observe.flush();

    const connect = transport.records.find(
      (record) =>
        record.type === "span:start" && record.primitive === "mcp.connect",
    );
    const discover = transport.records.find(
      (record) =>
        record.type === "span:start" && record.primitive === "mcp.discover",
    );
    const discoverEnd = transport.records.find(
      (record) =>
        record.type === "span:end" &&
        discover?.type === "span:start" &&
        record.spanId === discover.spanId,
    );

    expect(connect).toMatchObject({
      attributes: expect.objectContaining({
        sourceId: "native-catalog",
        implementation: "ai-sdk-native",
      }),
      definitionRefs: [
        {
          id: "mcp.server:native-catalog",
          kind: "mcp.server",
          role: "resolved-mcp-server",
        },
      ],
    });
    expect(discoverEnd).toMatchObject({
      attributes: expect.objectContaining({
        discoveredToolCount: 1,
        exposedToolCount: 1,
        toolListFingerprint: expect.stringMatching(/^sha256:/),
      }),
    });
  });
});
