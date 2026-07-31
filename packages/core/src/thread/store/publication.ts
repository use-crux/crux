/**
 * Pure publication-state helpers for Storage-backed Threads.
 *
 * @module
 */

import type { ThreadReceiptRecord } from "./records";

/** Whether a recovered receipt describes the exact immutable node group. */
export function receiptMatchesNodes(
  receipt: ThreadReceiptRecord | null,
  nodes: readonly { readonly id: string; readonly createdAt: string }[],
  parentId: string | null,
): receipt is ThreadReceiptRecord {
  return (
    receipt !== null &&
    receipt.committedAt === nodes[0]!.createdAt &&
    receipt.parentId === parentId &&
    receipt.messageIds.length === nodes.length &&
    receipt.messageIds.every((id, index) => id === nodes[index]!.id)
  );
}

/** Advance remembered alternatives that currently end at the append parent. */
export function advanceRememberedLeaves(
  leaves: Readonly<Record<string, string>>,
  parentId: string | null,
  leafId: string,
): {
  readonly value: Readonly<Record<string, string>>;
  readonly advanced: boolean;
} {
  if (!parentId) return { value: leaves, advanced: false };
  let advanced = false;
  const value = Object.fromEntries(
    Object.entries(leaves).map(([branch, rememberedLeaf]) => {
      if (rememberedLeaf !== parentId) return [branch, rememberedLeaf];
      advanced = true;
      return [branch, leafId];
    }),
  );
  return { value, advanced };
}
