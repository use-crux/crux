/**
 * Bounded live retention for linked support-call receipts.
 *
 * @internal
 * @module
 */

import type { RequestReceipt } from "./receipt";

const receipts = new Map<string, RequestReceipt>();
const RECEIPT_LIMIT = 128;

/** Retain a live support receipt for observability lookup by its linked ID. */
export function retainSupportRequestReceipt(
  receipt: RequestReceipt,
): void {
  receipts.set(receipt.id, receipt);
  while (receipts.size > RECEIPT_LIMIT) {
    const oldest = receipts.keys().next().value;
    if (typeof oldest !== "string") break;
    receipts.delete(oldest);
  }
}

/** Read a recently linked support receipt without exposing source content. */
export function supportRequestReceipt(
  id: string,
): RequestReceipt | undefined {
  return receipts.get(id);
}
