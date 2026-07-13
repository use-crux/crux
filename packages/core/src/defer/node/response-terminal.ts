import type { IncomingMessage, ServerResponse } from "node:http";
import type { ResponseFinishedTerminal } from "../lifecycle";

/** Subscribe a Node request/response pair to its first observable terminal. */
export function subscribeNodeResponseTerminal(
  request: IncomingMessage,
  response: ServerResponse,
  terminal: ResponseFinishedTerminal,
): () => void {
  const finish = () => terminal.finish();
  response.once("finish", finish);
  response.once("close", finish);
  request.once("aborted", finish);

  if (
    response.writableFinished ||
    response.closed ||
    response.destroyed ||
    request.aborted
  ) {
    terminal.finish();
  }

  return () => {
    response.off("finish", finish);
    response.off("close", finish);
    request.off("aborted", finish);
  };
}
