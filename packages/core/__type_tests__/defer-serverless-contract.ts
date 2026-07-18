/** Compile-time contract for serverless defer host integrations. */

import { expectTypeOf } from "vitest";
import {
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
import type { CruxHostBinding } from "@use-crux/core/internal/scope";

declare const waitUntil: DeferWaitUntilPort;
declare const after: DeferAfterPort;
declare const handler: (id: string) => Promise<{ ok: true }>;

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

declare const binding: CruxHostBinding;
const generic = withServerlessDefer(handler, {
  binding,
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
const namedOpts: NamedOnlyDeferWrapOptions = { host: "lambda" };
void waitOpts;
void afterOpts;
void namedOpts;

// @ts-expect-error waitUntil is required and must not be guessed from env.
withWaitUntilDefer(handler, {});

// @ts-expect-error after is required for response-finished Next-style hosts.
withAfterDefer(handler, {});
