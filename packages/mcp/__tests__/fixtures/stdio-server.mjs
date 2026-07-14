import { appendFileSync } from "node:fs";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const scenario = JSON.parse(
  Buffer.from(process.env.CRUX_MCP_FIXTURE_SCENARIO ?? "", "base64").toString(
    "utf8",
  ),
);
const logPath = process.env.CRUX_MCP_FIXTURE_LOG;
if (!logPath) throw new Error("CRUX_MCP_FIXTURE_LOG is required.");

const pages = new Map(scenario.pages.map((page) => [page.cursor, page]));
const server = new Server(
  { name: "crux-mcp-stdio-test", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async ({ params }) => {
  const cursor = params?.cursor;
  event({ type: "list", cursor });
  if (scenario.listDelayMs) await delay(scenario.listDelayMs);
  const page = pages.get(cursor);
  if (!page) throw new Error(`Unexpected tools/list cursor: ${cursor}`);
  return {
    tools: page.tools,
    ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
  };
});

server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
  event({
    type: "call",
    name: params.name,
    arguments: params.arguments ?? {},
  });
  if (scenario.callDelayMs) await delay(scenario.callDelayMs);
  if (scenario.callError) throw new Error(scenario.callError);
  return (
    scenario.callResult ?? {
      content: [{ type: "text", text: "ok" }],
    }
  );
});

process.on("exit", () => event({ type: "exit" }));
process.on("SIGTERM", () => process.exit(0));

event({ type: "started", pid: process.pid });
await server.connect(new StdioServerTransport());

function event(value) {
  appendFileSync(logPath, `${JSON.stringify(value)}\n`, "utf8");
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
