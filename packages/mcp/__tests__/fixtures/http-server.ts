import { randomUUID } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type IncomingHttpHeaders,
  type Server as HttpServer,
} from "node:http";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type ListToolsResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";

/** One cursor-addressable page returned by the fixture's `tools/list`. */
export interface McpToolPage {
  readonly cursor?: string;
  readonly tools: readonly Tool[];
  readonly nextCursor?: string;
}

/** Scenario controls exposed as real MCP server behavior. */
export interface McpHttpFixtureScenario {
  readonly pages: readonly McpToolPage[];
  /** Optional same-origin endpoint that redirects to the fixture's `/mcp`. */
  readonly redirectFromPath?: string;
  /** Emit an intentionally malformed response for client-boundary tests. */
  readonly unsafeListToolsResult?: (cursor: string | undefined) => unknown;
  readonly callTool?: (input: {
    readonly name: string;
    readonly arguments: Readonly<Record<string, unknown>>;
  }) => CallToolResult | Promise<CallToolResult>;
}

/** Running in-process Streamable HTTP MCP fixture. */
export interface McpHttpFixture {
  readonly url: string;
  readonly requestMethods: readonly string[];
  readonly requestHeaders: readonly IncomingHttpHeaders[];
  readonly requestedCursors: readonly (string | undefined)[];
  readonly toolCalls: readonly {
    readonly name: string;
    readonly arguments: Readonly<Record<string, unknown>>;
  }[];
  close(): Promise<void>;
}

/**
 * Start a real, stateless Streamable HTTP MCP server on an ephemeral port.
 *
 * Tests control protocol pages and calls through {@link McpHttpFixtureScenario}
 * rather than mocking the Crux materializer or official client.
 */
export async function startMcpHttpFixture(
  scenario: McpHttpFixtureScenario,
): Promise<McpHttpFixture> {
  const pages = new Map(
    scenario.pages.map((page) => [page.cursor, page] as const),
  );
  const requestedCursors: (string | undefined)[] = [];
  const requestMethods: string[] = [];
  const requestHeaders: IncomingHttpHeaders[] = [];
  const toolCalls: {
    readonly name: string;
    readonly arguments: Readonly<Record<string, unknown>>;
  }[] = [];
  const protocol = new Server(
    { name: "crux-mcp-test", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  protocol.setRequestHandler(ListToolsRequestSchema, ({ params }) => {
    const cursor = params?.cursor;
    requestedCursors.push(cursor);
    if (scenario.unsafeListToolsResult) {
      return scenario.unsafeListToolsResult(cursor) as ListToolsResult;
    }
    const page = pages.get(cursor);
    if (!page) throw new Error(`Unexpected tools/list cursor: ${cursor}`);
    return {
      tools: [...page.tools],
      ...(page.nextCursor !== undefined ? { nextCursor: page.nextCursor } : {}),
    };
  });

  protocol.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    if (!scenario.callTool) {
      throw new Error(`Unexpected tools/call request for ${params.name}`);
    }
    const call = {
      name: params.name,
      arguments: params.arguments ?? {},
    };
    toolCalls.push(call);
    return scenario.callTool(call);
  });

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: randomUUID,
    enableJsonResponse: true,
  });
  await protocol.connect(transport);

  const server = createServer((request, response) => {
    requestMethods.push(request.method ?? "UNKNOWN");
    requestHeaders.push({ ...request.headers });
    if (scenario.redirectFromPath === request.url) {
      response.writeHead(307, { location: "/mcp" });
      response.end();
      return;
    }
    void handleRequest(transport, request, response).catch((error: unknown) => {
      if (response.headersSent) {
        response.destroy(error instanceof Error ? error : undefined);
        return;
      }
      response.writeHead(
        500,
        error instanceof Error ? error.message : "Fixture request failed",
        { "content-type": "application/json" },
      );
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32603, message: "Fixture request failed" },
        }),
      );
    });
  });
  await listen(server);

  const address = server.address();
  if (!address || typeof address === "string") {
    await closeServer(server);
    throw new Error("MCP HTTP fixture did not bind an IP socket.");
  }

  let closed = false;
  return {
    url: `http://127.0.0.1:${address.port}${scenario.redirectFromPath ?? "/mcp"}`,
    requestMethods,
    requestHeaders,
    requestedCursors,
    toolCalls,
    async close() {
      if (closed) return;
      closed = true;
      await protocol.close();
      await closeServer(server);
    },
  };
}

async function handleRequest(
  transport: StreamableHTTPServerTransport,
  request: IncomingMessage,
  response: import("node:http").ServerResponse,
): Promise<void> {
  const body =
    request.method === "POST" ? await readJsonBody(request) : undefined;
  await transport.handleRequest(request, response, body);
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const body = Buffer.concat(chunks).toString("utf8");
  return body ? JSON.parse(body) : undefined;
}

function listen(server: HttpServer): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function closeServer(server: HttpServer): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
