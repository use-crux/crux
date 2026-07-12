/** Compile-time contract for request-scoped `defer()`. */

import { expectTypeOf } from "vitest";
import {
  defer,
  type Awaitable,
  type DeferredCallback,
  type DeferredWorkRef,
} from "@use-crux/core";
import { durableTask } from "@use-crux/core/runtime";
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

const sendEmail = durableTask("send-email", {
  run: async (input: { readonly messageId: string }) => input.messageId,
});
const namedResult = defer(sendEmail, { messageId: "message_1" });
expectTypeOf(namedResult).toEqualTypeOf<Promise<DeferredWorkRef>>();
namedResult.then((reference) => {
  if (reference.kind === "deferred.work") {
    expectTypeOf(reference.workId).toEqualTypeOf<string>();
    expectTypeOf(reference.targetId).toEqualTypeOf<string>();
  }
});

// @ts-expect-error Named targets require their inferred JSON input.
defer(sendEmail);
// @ts-expect-error Named target input is inferred from its target brand.
defer(sendEmail, { messageId: 42 });
// @ts-expect-error Non-JSON values cannot cross the durable target boundary.
defer(sendEmail, { messageId: () => "message_1" });

const auditMessage = durableTask("audit-message", {
  run: async (input: { readonly auditId: string }) => input.auditId,
});
declare const targetUnion: typeof sendEmail | typeof auditMessage;
declare const mismatchedUnionInput:
  | { readonly messageId: string }
  | { readonly auditId: string };
// @ts-expect-error A target union cannot be paired with an independently chosen input union.
defer(targetUnion, mismatchedUnionInput);

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
