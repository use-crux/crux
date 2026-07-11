import type { IncomingMessage, ServerResponse } from "node:http";
import { runWithDeferInvocation } from "../host";
import type {
  DeferHandlerSettlement,
  DeferInvocationOutcome,
  DeferScheduledTask,
} from "../host-types";
import { createResponseFinishedDeferLifetime } from "../lifecycle";
import type { NodeDeferHost, NodeDeferWrapOptions } from "../node";
import { handleNodeDeferError } from "./errors";
import { NODE_DEFER_POLICY } from "./policy";
import { NodeDeferRegistry, type NodeDeferRegistryEntry } from "./registry";
import { subscribeNodeResponseTerminal } from "./response-terminal";

/** Create the public Node host implementation. */
export function createNodeDeferHostImplementation(): NodeDeferHost {
  const registry = new NodeDeferRegistry(NODE_DEFER_POLICY.shutdownDrainMs);

  return Object.freeze({
    wrap<TRequest extends IncomingMessage, TResponse extends ServerResponse>(
      handler: (
        request: TRequest,
        response: TResponse,
      ) => void | PromiseLike<void>,
      options?: NodeDeferWrapOptions<TRequest, TResponse>,
    ): (request: TRequest, response: TResponse) => void {
      return (request, response): void => {
        let entry: NodeDeferRegistryEntry;
        let cancelWaiting: (reason?: unknown) => void = () => {};
        const lifetime = createResponseFinishedDeferLifetime({
          limits: NODE_DEFER_POLICY,
          durableFinalization: false,
          subscribe(terminal) {
            cancelWaiting = terminal.cancel;
            return subscribeNodeResponseTerminal(request, response, terminal);
          },
          start(task: DeferScheduledTask) {
            registry.start(entry, task);
          },
        });
        entry = registry.addWaiting((reason) => cancelWaiting(reason));

        const invocation = runWithDeferInvocation(
          () => handler(request, response),
          {
            lifetime,
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
