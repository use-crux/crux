/** Compile-time contract for request-scoped `defer()`. */

import { expectTypeOf } from "vitest";
import { defer, type Awaitable, type DeferredCallback } from "@use-crux/core";
import {
  runWithDeferInvocation,
  type DeferHostBoundaryOptions,
  type DeferLifetimeCapability,
} from "@use-crux/core/internal/defer-host";

const synchronousResult = defer(() => {});
const asynchronousResult = defer(async () => {});

expectTypeOf(synchronousResult).toEqualTypeOf<void>();
expectTypeOf(asynchronousResult).toEqualTypeOf<void>();
expectTypeOf<ReturnType<DeferredCallback>>().toEqualTypeOf<Awaitable<void>>();

// @ts-expect-error Public inline callbacks remain zero-argument functions.
defer((input: string) => {
  void input;
});

// @ts-expect-error Inline callbacks may not return application values.
defer(() => 42);

// @ts-expect-error Async inline callbacks may not resolve to application values.
defer(async () => "not-void");

declare const lifetime: DeferLifetimeCapability;
const hostOptions = {
  lifetime,
  classifyOutcome: (settlement) =>
    settlement.kind === "returned" ? "success" : "error",
} satisfies DeferHostBoundaryOptions<string>;

expectTypeOf(
  runWithDeferInvocation(() => "response", hostOptions),
).toEqualTypeOf<Promise<string>>();

const invalidHostOptions: DeferHostBoundaryOptions<string> = {
  lifetime,
  // @ts-expect-error Outcome classification must be synchronous.
  classifyOutcome: async () => "success",
};
void invalidHostOptions;
