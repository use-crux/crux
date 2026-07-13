/**
 * Explicit request-scoped deferred-work integration for Node HTTP servers.
 *
 * Inline work and each host registry are process-local. Multiprocess Node
 * deployments need named Runtime work when execution must survive or cross a
 * worker boundary.
 *
 * @module
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  DeferHandlerSettlement,
  DeferInvocationOutcome,
} from "./host-types";
import { createNodeDeferHostImplementation } from "./node/host";

/** Request and response attached to a Node defer error. */
export interface NodeDeferErrorContext<
  TRequest extends IncomingMessage = IncomingMessage,
  TResponse extends ServerResponse = ServerResponse,
> {
  readonly request: TRequest;
  readonly response: TResponse;
}

/** Error hook for a wrapped Node request listener. */
export type NodeDeferErrorHandler<
  TRequest extends IncomingMessage = IncomingMessage,
  TResponse extends ServerResponse = ServerResponse,
> = (
  error: unknown,
  context: NodeDeferErrorContext<TRequest, TResponse>,
) => void | PromiseLike<void>;

/** Context supplied to Node logical-outcome classification. */
export interface NodeDeferClassificationContext<
  TRequest extends IncomingMessage = IncomingMessage,
  TResponse extends ServerResponse = ServerResponse,
> {
  readonly request: TRequest;
  readonly response: TResponse;
  readonly settlement: DeferHandlerSettlement<void>;
}

/** Per-handler options for Node deferred work. */
export interface NodeDeferWrapOptions<
  TRequest extends IncomingMessage = IncomingMessage,
  TResponse extends ServerResponse = ServerResponse,
> {
  /** Map application/framework settlement to a logical outcome synchronously. */
  readonly classifyOutcome?: (
    context: NodeDeferClassificationContext<TRequest, TResponse>,
  ) => DeferInvocationOutcome;
  /** Handle the exact rejection produced by the wrapped invocation. */
  readonly onError?: NodeDeferErrorHandler<TRequest, TResponse>;
}

/** Result of a bounded Node defer shutdown. */
export interface NodeDeferShutdownResult {
  /** Whether every registered drain completed before the shutdown deadline. */
  readonly completed: boolean;
  /** Drains still running when bounded shutdown cancellation began. */
  readonly pending: number;
}

/** Isolated Node defer integration with its own shutdown registry. */
export interface NodeDeferHost {
  /** Wrap one Node request listener in a response-finished defer boundary. */
  wrap<TRequest extends IncomingMessage, TResponse extends ServerResponse>(
    handler: (
      request: TRequest,
      response: TResponse,
    ) => void | PromiseLike<void>,
    options?: NodeDeferWrapOptions<TRequest, TResponse>,
  ): (request: TRequest, response: TResponse) => void;
  /** Wait dynamically for this host's process-local drains, then cancel boundedly. */
  shutdown(): Promise<NodeDeferShutdownResult>;
}

/**
 * Create an isolated process-local Node defer host.
 *
 * Applications own server and process-signal shutdown ordering; Crux installs
 * no global HTTP hooks or signal handlers.
 *
 * @example
 * ```ts
 * const deferHost = createNodeDeferHost()
 * const server = createServer(deferHost.wrap(handler))
 *
 * process.once('SIGTERM', async () => {
 *   server.close()
 *   await deferHost.shutdown()
 * })
 * ```
 */
export function createNodeDeferHost(): NodeDeferHost {
  return createNodeDeferHostImplementation();
}

const defaultNodeDeferHost = createNodeDeferHostImplementation();

/**
 * Wrap a Node request listener with the module-local default defer host.
 *
 * @example
 * ```ts
 * const server = createServer(
 *   withNodeDefer(async (_request, response) => {
 *     defer(() => flushAnalytics())
 *     response.end('ok')
 *   }),
 * )
 * ```
 */
export function withNodeDefer<
  TRequest extends IncomingMessage,
  TResponse extends ServerResponse,
>(
  handler: (request: TRequest, response: TResponse) => void | PromiseLike<void>,
  options?: NodeDeferWrapOptions<TRequest, TResponse>,
): (request: TRequest, response: TResponse) => void {
  return defaultNodeDeferHost.wrap(handler, options);
}

/** Shut down the module-local default Node defer host. */
export async function shutdownNodeDefer(): Promise<NodeDeferShutdownResult> {
  return defaultNodeDeferHost.shutdown();
}
