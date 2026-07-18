import type { IncomingMessage, ServerResponse } from "node:http";

/** First terminal signal observed for a Node response boundary. */
export interface NodeResponseTerminal {
  finish(): void;
}

/** Subscribe a Node request/response pair to its first observable terminal. */
export function subscribeNodeResponseTerminal(
  request: IncomingMessage,
  response: ServerResponse,
  terminal: NodeResponseTerminal,
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
