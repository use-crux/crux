/** Stable internal identities for durable reactive records. */

/** Build one delivery identity from its occurrence and exact waiter binding. @internal */
export function signalDeliveryId(
  occurrenceId: string,
  waiterId: string,
): string {
  return `signal_delivery:${occurrenceId}:${waiterId}`;
}
