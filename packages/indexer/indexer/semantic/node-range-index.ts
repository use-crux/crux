import { resolve } from 'node:path'

/** Range-indexed AST lookup table for bridging equivalent compiler node trees. */
export interface NodeRangeIndex<TNode> {
  /** Nodes keyed by absolute file, start, end, and syntax kind name. */
  readonly byKey: Map<string, TNode>
  /** Nodes keyed by start and end only for compiler APIs that report coarser kinds. */
  readonly byRange: Map<string, TNode>
}

/** Builds stable node lookup tables for a compiler-owned AST tree. */
export function createNodeRangeIndex<TNode extends { readonly pos: number; readonly end: number }>(
  file: string,
  root: TNode,
  kindName: (node: TNode) => string,
  forEachChild: (node: TNode, visit: (child: TNode) => void) => void,
): NodeRangeIndex<TNode> {
  const byKey = new Map<string, TNode>()
  const byRange = new Map<string, TNode>()
  const visit = (node: TNode): void => {
    byKey.set(nodeRangeKey(file, node.pos, node.end, kindName(node)), node)
    byRange.set(nodeRangeFallbackKey(node.pos, node.end), node)
    forEachChild(node, visit)
  }
  visit(root)
  return { byKey, byRange }
}

/** Returns the exact lookup key used for a node range and syntax kind. */
export function nodeRangeKey(file: string, pos: number, end: number, kindName: string): string {
  return `${resolve(file)}:${pos}:${end}:${kindName}`
}

/** Returns the fallback lookup key used when equivalent compilers disagree on kind. */
export function nodeRangeFallbackKey(pos: number, end: number): string {
  return `${pos}:${end}`
}
