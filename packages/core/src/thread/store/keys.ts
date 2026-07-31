/**
 * Private Thread record keyspace.
 *
 * User identities are escaped so ordinary application IDs cannot escape the
 * Thread namespace or collide with structural separators.
 *
 * @module
 */

/** Control-record key for one Thread. */
export function threadControlKey(threadId: string): string {
  return `thread/${encodeURIComponent(threadId)}`;
}

/** Immutable node-record key for one Thread message. */
export function threadNodeKey(threadId: string, messageId: string): string {
  return `${threadControlKey(threadId)}/node/${encodeURIComponent(messageId)}`;
}

/** Immutable append-receipt key for one published causal group. */
export function threadReceiptKey(
  threadId: string,
  firstMessageId: string,
): string {
  return `${threadControlKey(threadId)}/receipt/${encodeURIComponent(firstMessageId)}`;
}
