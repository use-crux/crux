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
      compareAndSet: FunctionReference<
        "mutation",
        "internal",
        { doc: any; expectedVersion: string | null; key: string },
        boolean,
        Name
      >;
      get: FunctionReference<"query", "internal", { key: string }, any, Name>;
      insert: FunctionReference<
        "mutation",
        "internal",
        {
          content: string;
          embedding?: Array<number>;
          key: string;
          metadata?: any;
          updatedAt: number;
        },
        boolean,
        Name
      >;
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
    runtime: {
      composites: {
        run: FunctionReference<
          "mutation",
          "internal",
          { input: any; kind: string },
          any,
          Name
        >;
      };
      deferred: {
        createIntent: FunctionReference<
          "mutation",
          "internal",
          { intent: any },
          any,
          Name
        >;
        createScope: FunctionReference<
          "mutation",
          "internal",
          { scope: any },
          any,
          Name
        >;
        getIntent: FunctionReference<
          "mutation",
          "internal",
          { intentId: string; namespace: string },
          any,
          Name
        >;
        getScope: FunctionReference<
          "mutation",
          "internal",
          { namespace: string; scopeId: string },
          any,
          Name
        >;
        listIntents: FunctionReference<
          "mutation",
          "internal",
          {
            limit?: number;
            namespace: string;
            scopeId: string;
            state?: string;
          },
          any,
          Name
        >;
        listScopes: FunctionReference<
          "mutation",
          "internal",
          {
            leaseExpiresBefore?: number;
            limit?: number;
            namespace: string;
            state?: string;
          },
          any,
          Name
        >;
        putIntent: FunctionReference<
          "mutation",
          "internal",
          { intent: any },
          null,
          Name
        >;
        putScope: FunctionReference<
          "mutation",
          "internal",
          { scope: any },
          null,
          Name
        >;
      };
      eval_host: {
        admit: FunctionReference<
          "mutation",
          "internal",
          {
            job: any;
            maxConcurrentJobs: number;
            namespace: string;
            now: number;
            workId: string;
          },
          any,
          Name
        >;
      };
      events: {
        append: FunctionReference<
          "mutation",
          "internal",
          { event: any; idempotencyKey?: string },
          any,
          Name
        >;
        prune: FunctionReference<
          "mutation",
          "internal",
          { before: number; limit: number; namespace?: string },
          any,
          Name
        >;
        read: FunctionReference<
          "mutation",
          "internal",
          { after?: string; limit?: number; name?: string; namespace: string },
          any,
          Name
        >;
      };
      leases: {
        claim: FunctionReference<
          "mutation",
          "internal",
          { now: number; ownerId?: string; resource: string; ttlMs: number },
          any,
          Name
        >;
        extend: FunctionReference<
          "mutation",
          "internal",
          { lease: any; now: number; ttlMs: number },
          any,
          Name
        >;
        release: FunctionReference<
          "mutation",
          "internal",
          { lease: any },
          null,
          Name
        >;
      };
      outbox: {
        claimPending: FunctionReference<
          "mutation",
          "internal",
          { limit?: number; namespace?: string; now: number },
          any,
          Name
        >;
        confirm: FunctionReference<
          "mutation",
          "internal",
          { outboxId: string },
          null,
          Name
        >;
        get: FunctionReference<
          "mutation",
          "internal",
          { outboxId: string },
          any,
          Name
        >;
        list: FunctionReference<
          "mutation",
          "internal",
          { limit?: number; namespace: string; state?: string },
          any,
          Name
        >;
        listByWork: FunctionReference<
          "mutation",
          "internal",
          {
            limit?: number;
            namespace?: string;
            state?: string;
            workId: string;
          },
          any,
          Name
        >;
        prune: FunctionReference<
          "mutation",
          "internal",
          { before: number; limit: number; namespace?: string },
          any,
          Name
        >;
        put: FunctionReference<
          "mutation",
          "internal",
          { envelope: any; nextAttemptAt: number },
          any,
          Name
        >;
        retryLater: FunctionReference<
          "mutation",
          "internal",
          { nextAttemptAt: number; outboxId: string },
          null,
          Name
        >;
      };
      results: {
        deleteResult: FunctionReference<
          "mutation",
          "internal",
          { ref: any },
          null,
          Name
        >;
        get: FunctionReference<
          "mutation",
          "internal",
          { location: string },
          any,
          Name
        >;
        pruneUnreferenced: FunctionReference<
          "mutation",
          "internal",
          { before: number; limit: number; namespace: string },
          any,
          Name
        >;
        put: FunctionReference<
          "mutation",
          "internal",
          {
            chunks: Array<string>;
            createdAt: number;
            location: string;
            mediaType: string;
            namespace: string;
            sha256: string;
            size: number;
          },
          null,
          Name
        >;
      };
      state: {
        countWork: FunctionReference<
          "mutation",
          "internal",
          { namespace: string },
          any,
          Name
        >;
        createWork: FunctionReference<
          "mutation",
          "internal",
          { work: any },
          any,
          Name
        >;
        decrementIdle: FunctionReference<
          "mutation",
          "internal",
          { namespace: string; scope: string },
          number,
          Name
        >;
        getIdleCount: FunctionReference<
          "mutation",
          "internal",
          { namespace: string; scope: string },
          number,
          Name
        >;
        getSnapshot: FunctionReference<
          "mutation",
          "internal",
          { flowId: string; namespace: string },
          any,
          Name
        >;
        getWork: FunctionReference<
          "mutation",
          "internal",
          { namespace: string; workId: string },
          any,
          Name
        >;
        hasIdempotencyKey: FunctionReference<
          "mutation",
          "internal",
          { key: string; namespace: string },
          boolean,
          Name
        >;
        incrementIdle: FunctionReference<
          "mutation",
          "internal",
          { namespace: string; scope: string },
          number,
          Name
        >;
        listWork: FunctionReference<
          "mutation",
          "internal",
          {
            limit?: number;
            namespace: string;
            status: string;
            updatedBefore?: number;
          },
          any,
          Name
        >;
        markSnapshotDelivered: FunctionReference<
          "mutation",
          "internal",
          {
            eventId: string;
            namespace: string;
            payload: any;
            waiterId: string;
            workId: string;
          },
          null,
          Name
        >;
        pruneIdempotencyKeys: FunctionReference<
          "mutation",
          "internal",
          { before: number; limit: number; namespace?: string },
          any,
          Name
        >;
        pruneTerminalSnapshots: FunctionReference<
          "mutation",
          "internal",
          { before: number; limit: number; namespace?: string },
          any,
          Name
        >;
        pruneTerminalWork: FunctionReference<
          "mutation",
          "internal",
          { before: number; limit: number; namespace?: string },
          any,
          Name
        >;
        putIdempotencyKey: FunctionReference<
          "mutation",
          "internal",
          { record: any },
          null,
          Name
        >;
        putSnapshot: FunctionReference<
          "mutation",
          "internal",
          { snapshot: any },
          null,
          Name
        >;
        putWork: FunctionReference<
          "mutation",
          "internal",
          { work: any },
          null,
          Name
        >;
        setWorkPending: FunctionReference<
          "mutation",
          "internal",
          {
            from?: string | Array<string>;
            idempotencyKey: string;
            namespace: string;
            now: number;
            work: any;
            workId: string;
          },
          any,
          Name
        >;
      };
      timers: {
        claimDue: FunctionReference<
          "mutation",
          "internal",
          { limit?: number; namespace?: string; now: number },
          any,
          Name
        >;
        get: FunctionReference<
          "mutation",
          "internal",
          { timerId: string },
          any,
          Name
        >;
        list: FunctionReference<
          "mutation",
          "internal",
          { limit?: number; namespace: string; state?: string },
          any,
          Name
        >;
        listByWork: FunctionReference<
          "mutation",
          "internal",
          { workId: string },
          any,
          Name
        >;
        prune: FunctionReference<
          "mutation",
          "internal",
          { before: number; limit: number; namespace?: string },
          any,
          Name
        >;
        put: FunctionReference<
          "mutation",
          "internal",
          { timer: any },
          any,
          Name
        >;
        transition: FunctionReference<
          "mutation",
          "internal",
          { from: string; timerId: string; to: string },
          boolean,
          Name
        >;
      };
      waiters: {
        attachTimer: FunctionReference<
          "mutation",
          "internal",
          { timerId: string; waiterId: string },
          null,
          Name
        >;
        cancel: FunctionReference<
          "mutation",
          "internal",
          { waiterId: string },
          null,
          Name
        >;
        claimExpired: FunctionReference<
          "mutation",
          "internal",
          { limit?: number; namespace?: string; now: number },
          any,
          Name
        >;
        listByWork: FunctionReference<
          "mutation",
          "internal",
          { workId: string },
          any,
          Name
        >;
        prune: FunctionReference<
          "mutation",
          "internal",
          { before: number; limit: number; namespace?: string },
          any,
          Name
        >;
        register: FunctionReference<
          "mutation",
          "internal",
          { waiter: any },
          any,
          Name
        >;
        resolve: FunctionReference<
          "mutation",
          "internal",
          { eventName: string; namespace?: string; payload: any },
          any,
          Name
        >;
        transition: FunctionReference<
          "mutation",
          "internal",
          { from: string; to: string; waiterId: string },
          boolean,
          Name
        >;
      };
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
