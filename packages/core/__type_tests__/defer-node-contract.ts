/** Compile-time contract for the supported Node defer integration. */

import type { IncomingMessage, ServerResponse } from "node:http";
import { expectTypeOf } from "vitest";
import {
  createNodeDeferHost,
  shutdownNodeDefer,
  withNodeDefer,
  type NodeDeferClassificationContext,
  type NodeDeferErrorContext,
  type NodeDeferShutdownResult,
  type NodeDeferWrapOptions,
} from "@use-crux/core/defer/node";

interface AppRequest extends IncomingMessage {
  readonly tenantId: string;
}

interface AppResponse extends ServerResponse {
  readonly requestId: string;
}

declare const handler: (
  request: AppRequest,
  response: AppResponse,
) => Promise<void>;

const listener = withNodeDefer(handler, {
  classifyOutcome(context) {
    expectTypeOf(context).toEqualTypeOf<
      NodeDeferClassificationContext<AppRequest, AppResponse>
    >();
    return context.settlement.kind === "returned" ? "success" : "error";
  },
  onError(error, context) {
    expectTypeOf(error).toEqualTypeOf<unknown>();
    expectTypeOf(context).toEqualTypeOf<
      NodeDeferErrorContext<AppRequest, AppResponse>
    >();
  },
});
expectTypeOf(listener).toEqualTypeOf<
  (request: AppRequest, response: AppResponse) => void
>();

const host = createNodeDeferHost();
expectTypeOf(host.shutdown()).toEqualTypeOf<Promise<NodeDeferShutdownResult>>();
expectTypeOf(shutdownNodeDefer()).toEqualTypeOf<
  Promise<NodeDeferShutdownResult>
>();

const invalidOptions: NodeDeferWrapOptions<AppRequest, AppResponse> = {
  // @ts-expect-error Node logical outcome classification must be synchronous.
  classifyOutcome: async () => "success",
};
void invalidOptions;

// @ts-expect-error V1 Node policy is fixed and createNodeDeferHost takes no options.
createNodeDeferHost({ maxDrainMs: 1 });
