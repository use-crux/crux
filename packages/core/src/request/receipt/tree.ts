/**
 * Linked provider-request evidence for composition child invocations.
 *
 * @module
 */

import type { RequestReceipt } from "./receipt";

/** Composition families that expose child request evidence. */
export type ReceiptCompositionKind =
  | "pipeline"
  | "parallel"
  | "consensus"
  | "swarm";

/** One managed leaf and its ordered, already-linked provider requests. */
export interface InvocationRequestReceiptNode {
  /** Node discriminant. */
  readonly kind: "invocation";
  /** Composition-local child label. */
  readonly label: string;
  /** Zero-based schedule position. */
  readonly index: number;
  /** Managed child selected at this boundary. */
  readonly target: {
    readonly id: string;
    readonly operation: "language";
  };
  /** Provider requests in semantic-call order. */
  readonly receipts: readonly RequestReceipt[];
}

/** One nested composition returned by a function-only wrapper. */
export interface NestedRequestReceiptNode {
  /** Node discriminant. */
  readonly kind: "composition";
  /** Composition-local wrapper label. */
  readonly label: string;
  /** Zero-based schedule position. */
  readonly index: number;
  /** Nested child evidence retained without flattening causality. */
  readonly tree: CompositionRequestReceiptTree;
}

/** One child branch in a composition request-evidence tree. */
export type CompositionRequestReceiptNode =
  | InvocationRequestReceiptNode
  | NestedRequestReceiptNode;

/**
 * Linked provider-request tree exposed by a composition result.
 *
 * Receipt order preserves semantic provider-call order within each child;
 * `previousRequestId` continues to link calls from the same managed loop.
 */
export interface CompositionRequestReceiptTree {
  /** Stable definition and execution identity for the parent composition. */
  readonly composition: {
    readonly id: string;
    readonly executionId: string;
    readonly kind: ReceiptCompositionKind;
  };
  /** Managed leaves and nested child compositions in schedule order. */
  readonly children: readonly CompositionRequestReceiptNode[];
}

/** Read a nested composition tree from an arbitrary child output. @internal */
export function nestedRequestReceiptTree(
  value: unknown,
): CompositionRequestReceiptTree | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const tree = (value as { requestReceipts?: unknown }).requestReceipts;
  if (!tree || typeof tree !== "object" || Array.isArray(tree)) {
    return undefined;
  }
  const candidate = tree as Partial<CompositionRequestReceiptTree>;
  return candidate.composition && Array.isArray(candidate.children)
    ? (tree as CompositionRequestReceiptTree)
    : undefined;
}
