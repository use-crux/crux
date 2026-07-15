import { describe, expect, it } from "vitest";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ToolSourceSession } from "@use-crux/core/tools";

interface ConformanceTool {
  execute(
    input: Record<string, unknown>,
    options: {
      readonly toolCallId: string;
      readonly runtimeContext: unknown;
      readonly abortSignal?: AbortSignal;
    },
  ): unknown | Promise<unknown>;
}

/** External MCP behavior scripted for one isolated conformance case. */
export interface MaterializerScenario {
  readonly tools: readonly Tool[];
  readonly callTool: (
    name: string,
    input: Readonly<Record<string, unknown>>,
    signal: AbortSignal | undefined,
  ) => unknown | Promise<unknown>;
}

/** One live materializer session prepared against a scripted boundary. */
export interface PreparedMaterializerScenario {
  readonly session: ToolSourceSession & {
    readonly tools: Readonly<Record<string, ConformanceTool>>;
  };
  readonly calls: readonly {
    readonly name: string;
    readonly input: Readonly<Record<string, unknown>>;
  }[];
  readonly closed: () => boolean;
  dispose(): Promise<void>;
}

/** Client-specific bridge consumed by the shared observable contract suite. */
export interface MaterializerConformanceHarness {
  prepare(
    scenario: MaterializerScenario,
  ): Promise<PreparedMaterializerScenario>;
}

/** Register the observable MCP materializer contract against one client path. */
export function describeMcpMaterializerConformance(
  name: string,
  harness: MaterializerConformanceHarness,
): void {
  describe(`${name} MCP materializer conformance`, () => {
    it("validates input before remote execution", async () => {
      const prepared = await harness.prepare({
        tools: [stringTool("lookup")],
        callTool: () => ({ content: [{ type: "text", text: "called" }] }),
      });
      try {
        await expect(
          execute(prepared, "lookup", { query: 42 }),
        ).rejects.toThrow();
        expect(prepared.calls).toEqual([]);
      } finally {
        await prepared.dispose();
      }
      expect(prepared.closed()).toBe(true);
    });

    it("normalizes successful and protocol-error results", async () => {
      const prepared = await harness.prepare({
        tools: [stringTool("lookup"), stringTool("failing")],
        callTool: (name) => ({
          content: [
            {
              type: "text",
              text: name === "failing" ? "remote failure" : "found",
              _meta: { secret: "hidden" },
            },
          ],
          ...(name === "failing" ? { isError: true } : {}),
          _meta: { secret: "hidden" },
        }),
      });
      try {
        await expect(
          execute(prepared, "lookup", { query: "crux" }),
        ).resolves.toEqual({
          content: [{ type: "text", text: "found" }],
        });
        await expect(
          execute(prepared, "failing", { query: "crux" }),
        ).resolves.toEqual({
          content: [{ type: "text", text: "remote failure" }],
          isError: true,
        });
      } finally {
        await prepared.dispose();
      }
    });

    it("validates advertised structured output after remote execution", async () => {
      const prepared = await harness.prepare({
        tools: [
          {
            ...stringTool("count"),
            outputSchema: {
              type: "object",
              properties: { count: { type: "integer" } },
              required: ["count"],
              additionalProperties: false,
            },
          },
        ],
        callTool: () => ({
          content: [],
          structuredContent: { count: "invalid" },
        }),
      });
      try {
        await expect(
          execute(prepared, "count", { query: "crux" }),
        ).rejects.toThrow(/structured content|output schema/i);
        expect(prepared.calls).toHaveLength(1);
      } finally {
        await prepared.dispose();
      }
    });

    it("forwards cancellation to remote execution", async () => {
      const prepared = await harness.prepare({
        tools: [stringTool("slow")],
        callTool: (_name, _input, signal) =>
          new Promise((_, reject) => {
            signal?.addEventListener(
              "abort",
              () => reject(signal.reason ?? new Error("aborted")),
              { once: true },
            );
          }),
      });
      const controller = new AbortController();
      const pending = execute(
        prepared,
        "slow",
        { query: "crux" },
        controller.signal,
      );
      controller.abort(new Error("cancelled"));
      try {
        await expect(pending).rejects.toThrow(/cancelled|abort/i);
      } finally {
        await prepared.dispose();
      }
    });

    it("discovers a fresh tool set for every session", async () => {
      const first = await harness.prepare({
        tools: [stringTool("first")],
        callTool: () => ({ content: [] }),
      });
      const second = await harness.prepare({
        tools: [stringTool("second")],
        callTool: () => ({ content: [] }),
      });
      try {
        expect(Object.keys(first.session.tools)).toEqual(["first"]);
        expect(Object.keys(second.session.tools)).toEqual(["second"]);
      } finally {
        await second.dispose();
        await first.dispose();
      }
      expect(first.closed()).toBe(true);
      expect(second.closed()).toBe(true);
    });
  });
}

function stringTool(name: string): Tool {
  return {
    name,
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
      additionalProperties: false,
    },
  };
}

async function execute(
  prepared: PreparedMaterializerScenario,
  name: string,
  input: Record<string, unknown>,
  abortSignal?: AbortSignal,
): Promise<unknown> {
  return prepared.session.tools[name]!.execute(input, {
    toolCallId: `call-${name}`,
    runtimeContext: undefined,
    ...(abortSignal ? { abortSignal } : {}),
  });
}
