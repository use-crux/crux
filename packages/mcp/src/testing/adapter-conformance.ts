import { describe, expect, it } from "vitest";

/** Observable facts from one adapter invocation with a materialized MCP tool. */
export interface McpAdapterInvocationObservation {
  readonly materializeCount: number;
  readonly exposedToolNames: readonly string[];
  readonly executions: readonly {
    readonly name: string;
    readonly input: Readonly<Record<string, unknown>>;
  }[];
  readonly closeCount: number;
  readonly text: string;
}

/** Adapter-owned bridge consumed by the shared MCP invocation contract. */
export interface McpAdapterConformanceHarness {
  /** Run one complete model → MCP tool → model invocation. */
  invokeMcp(): Promise<McpAdapterInvocationObservation>;
  /** Run one ordinary prompt and report MCP materializer initialization count. */
  invokeOrdinary(): Promise<{ readonly materializeCount: number }>;
  /** Fail provider I/O after materialization and report source cleanup. */
  invokeProviderFailure(): Promise<{
    readonly rejected: boolean;
    readonly closeCount: number;
  }>;
}

/**
 * Register the adapter-level contract shared by every first-party MCP dialect.
 *
 * Protocol discovery, schemas, result normalization, cancellation, freshness,
 * and direct session cleanup are covered by
 * {@link describeMcpMaterializerConformance}. This suite pins the additional
 * adapter boundary: materialized tools enter the normal provider codec and
 * lifecycle, cleanup survives provider failure, and ordinary prompts never
 * initialize the optional MCP integration.
 */
export function describeMcpAdapterConformance(
  name: string,
  harness: McpAdapterConformanceHarness,
): void {
  describe(`${name} MCP adapter conformance`, () => {
    it("exposes and executes a lifecycle tool before closing its session", async () => {
      const observed = await harness.invokeMcp();

      expect(observed.materializeCount).toBe(1);
      expect(observed.exposedToolNames).toContain("lookup");
      expect(observed.executions).toEqual([
        { name: "lookup", input: { query: "crux" } },
      ]);
      expect(observed.closeCount).toBe(1);
      expect(observed.text).toBe("done");
    });

    it("closes the source when provider I/O fails", async () => {
      await expect(harness.invokeProviderFailure()).resolves.toEqual({
        rejected: true,
        closeCount: 1,
      });
    });

    it("does not initialize MCP for an ordinary prompt", async () => {
      await expect(harness.invokeOrdinary()).resolves.toEqual({
        materializeCount: 0,
      });
    });
  });
}
