import { afterEach, vi } from "vitest";

import {
  materializeAiSdkMcpToolSource,
  materializeMcpToolSource,
  mcp,
  streamableHttp,
} from "../src";
import { createAiSdkMcpClient } from "../src/ai-sdk/client";
import {
  startMcpHttpFixture,
  type McpHttpFixture,
} from "./fixtures/http-server";
import {
  describeMcpMaterializerConformance,
  type MaterializerConformanceHarness,
  type MaterializerScenario,
} from "../src/testing/materializer-conformance";

vi.mock("../src/ai-sdk/client", () => ({
  createAiSdkMcpClient: vi.fn(),
}));

const fixtures: McpHttpFixture[] = [];
const createClientMock = vi.mocked(createAiSdkMcpClient);

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.close()));
  createClientMock.mockReset();
});

describeMcpMaterializerConformance("official client", {
  async prepare(scenario) {
    const fixture = await startMcpHttpFixture({
      pages: [{ tools: scenario.tools }],
      callTool: ({ name, arguments: input }) =>
        scenario.callTool(name, input, undefined) as never,
    });
    fixtures.push(fixture);
    const session = await materializeMcpToolSource(source(fixture.url), {
      runtimeContext: undefined,
    });
    let closed = false;
    return {
      session,
      get calls() {
        return fixture.toolCalls.map(({ name, arguments: input }) => ({
          name,
          input,
        }));
      },
      closed: () => closed,
      async dispose() {
        await session.close();
        closed = true;
      },
    };
  },
});

describeMcpMaterializerConformance("AI SDK-native", nativeHarness());

function nativeHarness(): MaterializerConformanceHarness {
  return {
    async prepare(scenario) {
      const calls: Array<{
        name: string;
        input: Readonly<Record<string, unknown>>;
      }> = [];
      let closed = false;
      createClientMock.mockResolvedValueOnce(
        nativeClient(scenario, calls, () => {
          closed = true;
        }) as never,
      );
      const session = await materializeAiSdkMcpToolSource(
        source("https://mcp.example.test"),
        { runtimeContext: undefined },
      );
      return {
        session,
        calls,
        closed: () => closed,
        async dispose() {
          await session.close();
        },
      };
    },
  };
}

function nativeClient(
  scenario: MaterializerScenario,
  calls: Array<{ name: string; input: Readonly<Record<string, unknown>> }>,
  close: () => void,
) {
  return {
    listTools: async () => ({ tools: [...scenario.tools] }),
    toolsFromDefinitions: () =>
      Object.fromEntries(
        scenario.tools.map((tool) => [
          tool.name,
          {
            description: tool.description,
            inputSchema: { jsonSchema: tool.inputSchema },
            execute: async (
              input: Readonly<Record<string, unknown>>,
              options: { abortSignal?: AbortSignal },
            ) => {
              calls.push({ name: tool.name, input });
              return scenario.callTool(tool.name, input, options.abortSignal);
            },
            toModelOutput: ({ output }: { output: unknown }) => ({
              type: "json",
              value: output,
            }),
          },
        ]),
      ),
    close: async () => close(),
  };
}

function source(url: string) {
  return mcp({
    id: "conformance",
    transport: streamableHttp({ url }),
  });
}
