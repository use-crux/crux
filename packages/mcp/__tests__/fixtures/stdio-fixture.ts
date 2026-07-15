import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";

import type { McpStdioTransportConfig } from "../../src/index";

interface StdioToolPage {
  readonly cursor?: string;
  readonly tools: readonly Tool[];
  readonly nextCursor?: string;
}

/** Scenario controls consumed by the real spawned stdio fixture process. */
export interface McpStdioFixtureScenario {
  readonly pages: readonly StdioToolPage[];
  readonly callResult?: CallToolResult;
  readonly callError?: string;
  readonly listDelayMs?: number;
  readonly callDelayMs?: number;
}

export type McpStdioFixtureEvent =
  | { readonly type: "started"; readonly pid: number }
  | { readonly type: "list"; readonly cursor?: string }
  | {
      readonly type: "call";
      readonly name: string;
      readonly arguments: Readonly<Record<string, unknown>>;
    }
  | { readonly type: "exit" };

/** Prepared child-process fixture; spawning begins when the transport connects. */
export interface McpStdioFixture {
  readonly transport: McpStdioTransportConfig;
  events(): Promise<readonly McpStdioFixtureEvent[]>;
  waitForEvent(type: McpStdioFixtureEvent["type"]): Promise<void>;
  dispose(): Promise<void>;
}

/** Create isolated scenario/log state for one spawned MCP stdio process. */
export async function createMcpStdioFixture(
  scenario: McpStdioFixtureScenario,
): Promise<McpStdioFixture> {
  const directory = await mkdtemp(join(tmpdir(), "crux-mcp-stdio-"));
  const logPath = join(directory, "events.jsonl");
  const script = fileURLToPath(new URL("./stdio-server.mjs", import.meta.url));
  const encodedScenario = Buffer.from(JSON.stringify(scenario)).toString(
    "base64",
  );

  return {
    transport: {
      type: "stdio",
      command: process.execPath,
      args: [script],
      env: {
        CRUX_MCP_FIXTURE_LOG: logPath,
        CRUX_MCP_FIXTURE_SCENARIO: encodedScenario,
      },
    },
    events: () => readEvents(logPath),
    async waitForEvent(type) {
      const deadline = Date.now() + 3_000;
      while (Date.now() < deadline) {
        if ((await readEvents(logPath)).some((event) => event.type === type)) {
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error(`Timed out waiting for stdio fixture event "${type}".`);
    },
    async dispose() {
      const started = (await readEvents(logPath)).find(
        (event): event is Extract<McpStdioFixtureEvent, { type: "started" }> =>
          event.type === "started",
      );
      const exited = (await readEvents(logPath)).some(
        (event) => event.type === "exit",
      );
      if (started && !exited) {
        try {
          process.kill(started.pid, "SIGTERM");
        } catch {
          // The child already exited.
        }
      }
      await rm(directory, { force: true, recursive: true });
    },
  };
}

async function readEvents(
  logPath: string,
): Promise<readonly McpStdioFixtureEvent[]> {
  let contents: string;
  try {
    contents = await readFile(logPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return contents
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as McpStdioFixtureEvent);
}
