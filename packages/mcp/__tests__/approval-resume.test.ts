import { toolSourceReplayIdentity } from "@use-crux/core/tools";
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

describe("MCP approval replay identity", () => {
  it("attaches the secret-free discovered contract through Core's opaque seam", async () => {
    const fixture = await startMcpHttpFixture({
      pages: [
        {
          tools: [
            {
              name: "lookup",
              description: "Look up a record.",
              inputSchema: {
                type: "object",
                properties: { id: { type: "string" } },
                required: ["id"],
              },
            },
          ],
        },
      ],
    });
    fixtures.push(fixture);
    const session = await materializeMcpToolSource(
      mcp({
        id: "approval-server",
        transport: streamableHttp({ url: fixture.url }),
        tools: { prefix: "server_" },
      }),
      { runtimeContext: undefined },
    );

    expect(toolSourceReplayIdentity(session.tools.server_lookup)).toEqual({
      kind: "mcp",
      serverId: "approval-server",
      remoteName: "lookup",
      exposedName: "server_lookup",
      inputSchemaFingerprint:
        session.tools.server_lookup?.mcp.inputSchemaFingerprint,
    });

    await session.close();
  });

  it("lets reconnect fixtures deterministically expose a changed schema", async () => {
    const fixture = await startMcpHttpFixture({ pages: [toolPage("string")] });
    fixtures.push(fixture);
    const source = mcp({
      id: "mutable-approval-server",
      transport: streamableHttp({ url: fixture.url }),
    });
    const first = await materializeMcpToolSource(source, {
      runtimeContext: undefined,
    });
    const firstIdentity = toolSourceReplayIdentity(first.tools.lookup);
    await first.close();

    fixture.replaceToolPages([toolPage("number")]);
    await fixture.resetConnection();
    const second = await materializeMcpToolSource(source, {
      runtimeContext: undefined,
    });

    expect(toolSourceReplayIdentity(second.tools.lookup)).not.toEqual(
      firstIdentity,
    );
    await second.close();
  });
});

function toolPage(type: "string" | "number") {
  return {
    tools: [
      {
        name: "lookup",
        inputSchema: {
          type: "object" as const,
          properties: { id: { type } },
          required: ["id"],
        },
      },
    ],
  };
}
