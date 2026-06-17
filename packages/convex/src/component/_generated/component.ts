/* eslint-disable */
/**
 * Generated `ComponentApi` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type { FunctionReference } from "convex/server";

/**
 * A utility for referencing a Convex component's exposed API.
 *
 * Useful when expecting a parameter like `components.myComponent`.
 * Usage:
 * ```ts
 * async function myFunction(ctx: QueryCtx, component: ComponentApi) {
 *   return ctx.runQuery(component.someFile.someQuery, { ...args });
 * }
 * ```
 */
export type ComponentApi<Name extends string | undefined = string | undefined> =
  {
    memory: {
      get: FunctionReference<"query", "internal", { key: string }, any, Name>;
      list: FunctionReference<
        "query",
        "internal",
        { cursor?: string; limit?: number; prefix?: string },
        { cursor?: string; docs: Array<any> },
        Name
      >;
      remove: FunctionReference<
        "mutation",
        "internal",
        { key: string },
        null,
        Name
      >;
      set: FunctionReference<
        "mutation",
        "internal",
        {
          content: string;
          embedding?: Array<number>;
          key: string;
          metadata?: any;
          updatedAt: number;
        },
        null,
        Name
      >;
    };
    swarm: {
      getState: FunctionReference<
        "query",
        "internal",
        { swarmRunId: string },
        any,
        Name
      >;
      listRuns: FunctionReference<
        "query",
        "internal",
        { limit?: number; status?: "running" | "completed" | "error" },
        any,
        Name
      >;
      saveState: FunctionReference<
        "mutation",
        "internal",
        {
          currentAgentId: string;
          currentInput: any;
          error?: string;
          flowId: string;
          handoffCount: number;
          handoffPath: Array<string>;
          history: "transfer-only" | "accumulate";
          maxHandoffs: number;
          observability?: any;
          originalInput: any;
          output?: any;
          sessionId?: string;
          status: "running" | "completed" | "error";
          swarmRunId: string;
        },
        null,
        Name
      >;
    };
  };
