import type { IncomingMessage, ServerResponse } from "node:http";
import { runWithDeferInvocation } from "../host";
import type {
  DeferHandlerSettlement,
  DeferInvocationOutcome,
} from "../host-types";
import type { CruxHostBinding } from "../../scope/types";
import type { NodeDeferHost, NodeDeferWrapOptions } from "../node";
import { handleNodeDeferError } from "./errors";
import { NODE_DEFER_POLICY } from "./policy";
import {
  createNodeDeferRegistry,
  type NodeDeferRegistryEntry,
} from "./registry";
import { subscribeNodeResponseTerminal } from "./response-terminal";

/** Create the public Node host implementation. */
export function createNodeDeferHostImplementation(): NodeDeferHost {
  const registry = createNodeDeferRegistry(NODE_DEFER_POLICY.shutdownDrainMs);

  return Object.freeze({
    wrap<TRequest extends IncomingMessage, TResponse extends ServerResponse>(
      handler: (
        request: TRequest,
        response: TResponse,
      ) => void | PromiseLike<void>,
      options?: NodeDeferWrapOptions<TRequest, TResponse>,
    ): (request: TRequest, response: TResponse) => void {
      return (request, response): void => {
        const abortController = new AbortController();
        let entry: NodeDeferRegistryEntry | undefined;
        let retainedWork: (() => Promise<void>) | undefined;
        let finished = false;
        let cancelled = false;
        let unsubscribe = (): void => {};

        const startIfReady = (): void => {
          if (!finished || cancelled || !entry || !retainedWork) return;
          const work = retainedWork;
          retainedWork = undefined;
          registry.start(entry, work);
        };

        unsubscribe = subscribeNodeResponseTerminal(request, response, {
          finish(): void {
            if (finished || cancelled) return;
            finished = true;
            unsubscribe();
            startIfReady();
          },
        });
        entry = registry.addWaiting((reason) => {
          cancelled = true;
          unsubscribe();
          abortController.abort(reason);
        });
        startIfReady();

        const binding = Object.freeze({
          kind: "node",
          invocationScope: false,
          supportsInline: true,
          durableFinalization: false,
          limits: NODE_DEFER_POLICY,
          retain(work): void {
            if (retainedWork) {
              throw new TypeError(
                "A Node invocation may retain only one root drain.",
              );
            }
            retainedWork = work;
            startIfReady();
          },
        } satisfies CruxHostBinding);

        const invocation = runWithDeferInvocation(
          () => handler(request, response),
          {
            binding,
            abortController,
            classifyOutcome: (settlement) =>
              classifyNodeOutcome(request, response, settlement, options),
          },
        );
        void invocation.catch((error: unknown) =>
          handleNodeDeferError(error, { request, response }, options?.onError),
        );
      };
    },
    shutdown: () => registry.shutdown(),
  });
}

/** Classify Node handler settlement without inferring framework semantics. */
export function classifyNodeOutcome<
  TRequest extends IncomingMessage,
  TResponse extends ServerResponse,
>(
  request: TRequest,
  response: TResponse,
  settlement: DeferHandlerSettlement<void>,
  options: NodeDeferWrapOptions<TRequest, TResponse> | undefined,
): DeferInvocationOutcome {
  if (options?.classifyOutcome) {
    return options.classifyOutcome({ request, response, settlement });
  }
  if (settlement.kind === "returned") return "success";
  return request.aborted ||
    response.destroyed ||
    (response.closed && !response.writableFinished)
    ? "cancelled"
    : "error";
}
