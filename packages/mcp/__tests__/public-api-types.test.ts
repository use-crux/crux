import { prompt, type ContextEntry } from "@use-crux/core";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  mcp,
  stdio,
  streamableHttp,
  type McpTransportConfig,
  type McpToolSource,
} from "@use-crux/mcp";

describe("MCP public types", () => {
  it("preserves source, transport, and runtime-context inference", async () => {
    const staticSource = mcp({
      id: "static",
      transport: stdio({ command: "fixture-server" }),
    });
    const dynamicSource = mcp<{ token: string }>({
      id: "dynamic",
      transport: ({ runtimeContext, abortSignal }) => {
        expectTypeOf(runtimeContext.token).toEqualTypeOf<string>();
        expectTypeOf(abortSignal).toEqualTypeOf<AbortSignal | undefined>();
        return streamableHttp({
          url: "https://mcp.example.test",
          headers: { Authorization: `Bearer ${runtimeContext.token}` },
        });
      },
    });
    const assistant = prompt({
      use: [staticSource, dynamicSource],
      prompt: "Use the available tools.",
    });

    expectTypeOf(staticSource).toMatchTypeOf<ContextEntry>();
    expectTypeOf(dynamicSource).toEqualTypeOf<
      McpToolSource<{ token: string }>
    >();
    expect((await assistant.resolve({})).toolSources).toEqual([
      staticSource,
      dynamicSource,
    ]);
  });

  it("narrows transport configurations exhaustively", () => {
    const describeTransport = (transport: McpTransportConfig): string => {
      switch (transport.type) {
        case "stdio":
          return transport.command;
        case "streamable-http":
          return transport.url.toString();
        default:
          return assertNever(transport);
      }
    };

    expect(describeTransport(stdio({ command: "node" }))).toBe("node");
  });
});

function assertNever(value: never): never {
  throw new Error(`Unexpected transport: ${String(value)}`);
}

function compileTimeRejections(): void {
  // @ts-expect-error id is required
  mcp({ transport: stdio({ command: "node" }) });

  // @ts-expect-error transport is required
  mcp({ id: "missing-transport" });

  mcp({
    id: "conflicting-selection",
    transport: stdio({ command: "node" }),
    // @ts-expect-error allow and deny are mutually exclusive
    tools: { allow: ["read"], deny: ["write"] },
  });

  // @ts-expect-error stdio requires a command
  stdio({ args: ["fixture.mjs"] });

  streamableHttp({
    url: "https://mcp.example.test",
    // @ts-expect-error redirect is a closed literal union
    redirect: "manual",
  });
}

void compileTimeRejections;
