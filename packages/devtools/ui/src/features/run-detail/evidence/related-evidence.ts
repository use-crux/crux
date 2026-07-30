/** Structural-descendant projection for the bounded Related Evidence index. */

export interface EvidenceStructuralNode {
  readonly id: string;
  readonly spanId?: string;
  readonly name: string;
  readonly children: readonly EvidenceStructuralNode[];
}

/** Project already-authorized descendant counts without aggregating roles. */
export function projectRelatedEvidence(input: {
  readonly root: EvidenceStructuralNode;
  readonly selectedId: string;
  readonly countsBySubject: ReadonlyMap<string, number>;
  readonly limit: number;
}) {
  const selected = findStructuralNode(input.root, input.selectedId);
  const descendants = selected ? structuralDescendants(selected) : [];
  const seenSubjects = new Set<string>();
  const completeRows = descendants.flatMap((node) => {
    const spanId = node.spanId ?? node.id;
    const subjectKey = `execution:${spanId}`;
    if (seenSubjects.has(subjectKey)) return [];
    seenSubjects.add(subjectKey);
    const count = input.countsBySubject.get(subjectKey) ?? 0;
    return count > 0
      ? [
          Object.freeze({
            subject: Object.freeze({ kind: "execution" as const, id: spanId }),
            label: node.name,
            kind: "span" as const,
            recordCount: count,
          }),
        ]
      : [];
  });
  const rows = completeRows.slice(0, Math.max(0, input.limit));
  return Object.freeze({
    total: completeRows.length,
    showing: rows.length,
    rows: Object.freeze(rows),
  });
}

/** Return only structural descendants in stable depth-first display order. */
export function structuralDescendants(
  root: EvidenceStructuralNode,
): EvidenceStructuralNode[] {
  const rows: EvidenceStructuralNode[] = [];
  const visit = (node: EvidenceStructuralNode) => {
    for (const child of node.children) {
      rows.push(child);
      visit(child);
    }
  };
  visit(root);
  return rows;
}

/** Resolve one presentation node by its structural or canonical span ID. */
export function findStructuralNode(
  node: EvidenceStructuralNode,
  id: string,
): EvidenceStructuralNode | undefined {
  if (node.id === id || node.spanId === id) return node;
  for (const child of node.children) {
    const found = findStructuralNode(child, id);
    if (found) return found;
  }
  return undefined;
}
