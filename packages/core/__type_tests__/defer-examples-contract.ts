/**
 * Compiling examples for request-scoped defer host integrations.
 *
 * These snippets mirror public docs and must typecheck with the package root
 * and host subpaths. They are not executed as unit tests.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { defer, type DeferredWorkRef } from "@use-crux/core";
import { withNodeDefer } from "@use-crux/core/defer/node";
import {
  withAfterDefer,
  withNamedOnlyDefer,
  withWaitUntilDefer,
} from "@use-crux/core/defer/serverless";
import { durableTask } from "@use-crux/core/runtime";
import { expectTypeOf } from "vitest";

const sendEmail = durableTask("docs-send-email", {
  run: async (input: { readonly messageId: string }) => input.messageId,
});

// --- Node HTTP (response-finished, process-local inline) ---
const nodeListener = withNodeDefer(
  async (_request: IncomingMessage, response: ServerResponse) => {
    defer(() => {
      // after response finish
    });
    response.end("ok");
  },
);
expectTypeOf(nodeListener).toEqualTypeOf<
  (request: IncomingMessage, response: ServerResponse) => void
>();

// --- Next-style after() injection (response-finished) ---
declare const after: (task: () => void | Promise<void>) => void;
const nextStyle = withAfterDefer(
  async () => {
    defer(() => {
      // after response finishes
    });
    return Response.json({ ok: true as const });
  },
  { after },
);
expectTypeOf(nextStyle).returns.resolves.toEqualTypeOf<Response>();

// --- waitUntil (handler-returned; may overlap streaming) ---
declare const waitUntil: (promise: Promise<void>) => void;
const waitUntilStyle = withWaitUntilDefer(
  async () => {
    defer(() => {
      // may overlap body stream
    });
    return new Response("ok");
  },
  { waitUntil },
);
expectTypeOf(waitUntilStyle).returns.resolves.toEqualTypeOf<Response>();

// --- Generic serverless with explicit lifetime only ---
// (no platform env guessing — lifetime is required at the type level)
const serverlessNamed = withNamedOnlyDefer(
  async (event: { readonly id: string }) => {
    const reference: DeferredWorkRef = await defer(sendEmail, {
      messageId: event.id,
    });
    return { workId: reference.workId, kind: reference.kind };
  },
  { host: "lambda", durableFinalization: true },
);
expectTypeOf(serverlessNamed).parameter(0).toEqualTypeOf<{
  readonly id: string;
}>();

// --- Convex / Lambda named-only inline is intentionally unsupported at runtime.
// Compile-time surface still allows the registration expression inside a wrapped
// handler; the named-only lifetime throws DEFER_CAPABILITY_MISSING at runtime.
const namedOnlyHost = withNamedOnlyDefer(async () => {
  return { ok: true as const };
});
expectTypeOf(namedOnlyHost).returns.resolves.toEqualTypeOf<{ ok: true }>();
