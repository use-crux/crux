/** Compile-time contract for serverless defer host integrations. */

import { expectTypeOf } from "vitest";
import {
  createAfterDeferLifetime,
  createNamedOnlyDeferLifetime,
  createWaitUntilDeferLifetime,
  withAfterDefer,
  withNamedOnlyDefer,
  withServerlessDefer,
  withWaitUntilDefer,
  type AfterDeferWrapOptions,
  type DeferAfterPort,
  type DeferWaitUntilPort,
  type NamedOnlyDeferWrapOptions,
  type WaitUntilDeferWrapOptions,
} from "@use-crux/core/defer/serverless";
import type { DeferLifetimeCapability } from "@use-crux/core/internal/scope";

declare const waitUntil: DeferWaitUntilPort;
declare const after: DeferAfterPort;
declare const handler: (id: string) => Promise<{ ok: true }>;

const waitUntilLifetime = createWaitUntilDeferLifetime({ waitUntil });
expectTypeOf(waitUntilLifetime).toMatchTypeOf<DeferLifetimeCapability>();
expectTypeOf(waitUntilLifetime.completion).toEqualTypeOf<"handler-returned">();

const afterLifetime = createAfterDeferLifetime({ after });
expectTypeOf(afterLifetime).toMatchTypeOf<DeferLifetimeCapability>();
expectTypeOf(afterLifetime.completion).toEqualTypeOf<"response-finished">();

const namedOnly = createNamedOnlyDeferLifetime({ host: "lambda" });
expectTypeOf(namedOnly).toMatchTypeOf<DeferLifetimeCapability>();
expectTypeOf(namedOnly.supportsInline).toEqualTypeOf<false>();
expectTypeOf(namedOnly.completion).toEqualTypeOf<"handler-returned">();

const waitWrapped = withWaitUntilDefer(handler, { waitUntil });
expectTypeOf(waitWrapped).toEqualTypeOf<
  (id: string) => Promise<{ ok: true }>
>();

const afterWrapped = withAfterDefer(handler, { after });
expectTypeOf(afterWrapped).toEqualTypeOf<
  (id: string) => Promise<{ ok: true }>
>();

const namedWrapped = withNamedOnlyDefer(handler, { host: "convex" });
expectTypeOf(namedWrapped).toEqualTypeOf<
  (id: string) => Promise<{ ok: true }>
>();

const generic = withServerlessDefer(handler, {
  lifetime: waitUntilLifetime,
  classifyOutcome(settlement) {
    return settlement.kind === "returned" ? "success" : "error";
  },
});
expectTypeOf(generic).toEqualTypeOf<(id: string) => Promise<{ ok: true }>>();

const waitOpts: WaitUntilDeferWrapOptions<{ ok: true }> = {
  waitUntil,
  durableFinalization: true,
};
const afterOpts: AfterDeferWrapOptions<{ ok: true }> = { after };
const namedOpts: NamedOnlyDeferWrapOptions<{ ok: true }> = { host: "lambda" };
void waitOpts;
void afterOpts;
void namedOpts;

// @ts-expect-error waitUntil is required and must not be guessed from env.
withWaitUntilDefer(handler, {});

// @ts-expect-error after is required for response-finished Next-style hosts.
withAfterDefer(handler, {});
