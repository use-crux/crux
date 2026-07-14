import { adapter, prompt } from "@use-crux/core";
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from "@use-crux/core/observability";
import { afterEach, describe, expect, it } from "vitest";

import {
  materializeMcpToolSource,
  mcp,
  stdio,
  streamableHttp,
} from "../src/index";
import {
  startMcpHttpFixture,
  type McpHttpFixture,
} from "./fixtures/http-server";

const fixtures: McpHttpFixture[] = [];
const BINARY_CANARY = "mcp-binary-payload-must-not-be-captured";
const BINARY_BASE64 = Buffer.from(BINARY_CANARY).toString("base64");

afterEach(async () => {
  resetObservabilityRuntime();
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.close()));
});

describe("MCP observability privacy", () => {
  it("omits credentials, protocol metadata, and raw binary from every graph record", async () => {
    const fixture = await startMcpHttpFixture({
      pages: [
        {
          tools: [
            {
              name: "render",
              inputSchema: { type: "object", properties: {} },
            },
          ],
        },
      ],
      callTool: () => ({
        content: [
          { type: "image", data: BINARY_BASE64, mimeType: "image/png" },
        ],
        _meta: { privateToken: "token-meta-canary" },
      }),
    });
    fixtures.push(fixture);
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    const source = mcp({
      id: "private-catalog",
      transport: streamableHttp({
        url: `${fixture.url}?token=token-query-canary`,
        headers: {
          Authorization: "Bearer bearer-header-canary",
          "X-API-Key": "key-header-canary",
        },
      }),
    });
    let providerCalls = 0;
    const model = adapter({
      providerId: "privacy-fixture",
      materializeToolSource: materializeMcpToolSource,
      mapSettings: () => ({}),
      async call() {
        providerCalls += 1;
        return {
          raw: { providerCalls },
          extracted: {
            text: providerCalls === 1 ? "" : "done",
            usage: {
              inputTokens: 1,
              outputTokens: 1,
              totalTokens: 2,
              inputTokenDetails: {},
              outputTokenDetails: {},
            },
            responseId: `response-${providerCalls}`,
            actualModelId: "fixture-model",
            finishReason: providerCalls === 1 ? "tool-calls" : "stop",
            toolCalls:
              providerCalls === 1
                ? [{ id: "call-1", name: "render", args: {} }]
                : undefined,
          },
        };
      },
      async stream() {
        throw new Error("not used");
      },
      appendToolRound(messages, assistant, results) {
        return [
          ...messages,
          { role: "assistant", content: assistant.text },
          ...results.map((result) => ({
            role: "tool" as const,
            content: result.content,
          })),
        ];
      },
    })({});

    await model.generate(
      prompt({ id: "private-mcp", use: [source], prompt: "Render it." }),
      { model: "fixture-model" },
    );
    await observe.flush();

    const evidence = JSON.stringify(transport.records);
    for (const secret of [
      "token-query-canary",
      "bearer-header-canary",
      "key-header-canary",
      "token-meta-canary",
      BINARY_CANARY,
      BINARY_BASE64,
    ]) {
      expect(evidence).not.toContain(secret);
    }
  });

  it("sanitizes resolver causes and never records stdio environment values", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    const resolverSecret = "token-resolver-canary";
    const environmentSecret = "token-stdio-environment-canary";

    await expect(
      materializeMcpToolSource(
        mcp({
          id: "resolver-failure",
          transport: async () => {
            throw new Error(
              `Authorization: Bearer bearer-resolver-canary ${resolverSecret}`,
            );
          },
        }),
        { runtimeContext: undefined },
      ),
    ).rejects.not.toThrow(/resolver-canary/);

    await expect(
      materializeMcpToolSource(
        mcp({
          id: "stdio-failure",
          transport: stdio({
            command: "missing-mcp-observability-fixture",
            env: { MCP_SECRET: environmentSecret },
          }),
        }),
        { runtimeContext: undefined, abortSignal: AbortSignal.timeout(500) },
      ),
    ).rejects.toBeDefined();
    await observe.flush();

    const evidence = JSON.stringify(transport.records);
    expect(evidence).not.toContain("bearer-resolver-canary");
    expect(evidence).not.toContain(resolverSecret);
    expect(evidence).not.toContain(environmentSecret);
  });
});
