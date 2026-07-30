/** Presentation ownership for domain-native and generic evidence records. */

export type EvidenceRendererId =
  | "approval"
  | "tool"
  | "memory"
  | "retrieval"
  | "safety"
  | "evaluation"
  | "media"
  | "generic";

export interface EvidenceRenderer {
  readonly id: EvidenceRendererId;
  readonly label: string;
}

const rendererPrefixes: readonly [
  prefix: string,
  renderer: EvidenceRenderer,
][] = [
  ["approval.", { id: "approval", label: "Approval" }],
  ["tool.", { id: "tool", label: "Tool" }],
  ["memory.", { id: "memory", label: "Memory" }],
  ["retrieval.", { id: "retrieval", label: "Retrieval" }],
  ["constraint.", { id: "safety", label: "Safety" }],
  ["guardrail.", { id: "safety", label: "Safety" }],
  ["validation.", { id: "safety", label: "Validation" }],
  ["security.", { id: "safety", label: "Security" }],
  ["score.", { id: "evaluation", label: "Evaluation" }],
  ["citation.", { id: "evaluation", label: "Evaluation" }],
  ["media.", { id: "media", label: "Media" }],
];

/** Resolve the one renderer that owns a canonical source kind. */
export function evidenceRendererForKind(kind: string): EvidenceRenderer {
  return (
    rendererPrefixes.find(([prefix]) => kind.startsWith(prefix))?.[1] ?? {
      id: "generic",
      label: "Evidence record",
    }
  );
}

export type EvidencePresentationSurface =
  | "generic-collection"
  | "graph"
  | "story"
  | "raw"
  | "share"
  | "json";

/**
 * Decide whether a generic collection owns one evidence relationship.
 *
 * @remarks Suppression fails open. Raw/debug/export surfaces always retain
 * canonical records. A paged-out row counts as represented only when the
 * mounted panel discloses a non-zero remaining count.
 */
export function shouldRenderGenericEvidence(input: {
  readonly surface: EvidencePresentationSurface;
  readonly key: string;
  readonly representedKeys: ReadonlySet<string>;
  readonly pagedOutKeys?: ReadonlySet<string>;
  readonly honestRemainingCount?: number;
}): boolean {
  if (input.surface !== "generic-collection") return true;
  if (input.representedKeys.has(input.key)) return false;
  return !(
    input.pagedOutKeys?.has(input.key) &&
    Number.isSafeInteger(input.honestRemainingCount) &&
    (input.honestRemainingCount ?? 0) > 0
  );
}
