import type { IncomingMessage, ServerResponse } from "node:http";
import type { NodeDeferErrorContext, NodeDeferErrorHandler } from "../node";

/** Default containment policy for a rejected wrapped Node handler. */
export function defaultNodeDeferErrorHandler(
  error: unknown,
  { response }: NodeDeferErrorContext,
): void {
  if (!response.headersSent && !response.writableEnded) {
    response.statusCode = 500;
    response.end();
    return;
  }

  if (!response.destroyed) {
    response.destroy(error instanceof Error ? error : undefined);
  }
}

/** Run a custom handler and fall back safely if it also fails. */
export async function handleNodeDeferError<
  TRequest extends IncomingMessage,
  TResponse extends ServerResponse,
>(
  error: unknown,
  context: NodeDeferErrorContext<TRequest, TResponse>,
  handler: NodeDeferErrorHandler<TRequest, TResponse> | undefined,
): Promise<void> {
  if (handler) {
    try {
      await handler(error, context);
      return;
    } catch {
      // Fall through to the default transport-safe containment policy.
    }
  }

  try {
    defaultNodeDeferErrorHandler(error, context);
  } catch {
    // A broken/destroyed response must not create a second unhandled failure.
  }
}
