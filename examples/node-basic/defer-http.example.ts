/**
 * Compiling example: Node request-scoped inline defer.
 *
 * Run behind a real HTTP server in apps; this module documents the public
 * surface and is discovered by Project Index as deferred-work definitions.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { defer } from "@use-crux/core";
import { withNodeDefer } from "@use-crux/core/defer/node";

/** Sample Node listener that schedules process-local post-response work. */
export const deferredNodeListener = withNodeDefer(
  async (_request: IncomingMessage, response: ServerResponse) => {
    defer(() => {
      // Starts after response finish (completion class: response-finished).
    });
    response.statusCode = 200;
    response.end("ok");
  },
);
