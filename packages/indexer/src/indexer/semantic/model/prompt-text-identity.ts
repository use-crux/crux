import type { SemanticAnalyzerNode, SemanticAnalyzerView } from "../candidates";

export const canonicalPromptTextIdentity = {
  module: "@use-crux/core",
  export: "md",
} as const;

/** Returns whether the active compiler proves the canonical Crux `md` tag. */
export function isCanonicalPromptTextTag(
  tag: SemanticAnalyzerNode<SemanticAnalyzerView>,
  view: SemanticAnalyzerView,
): boolean {
  const identity = view.canonicalExportIdentity(
    tag,
    canonicalPromptTextIdentity.module,
    canonicalPromptTextIdentity.export,
  );
  return (
    identity?.module === canonicalPromptTextIdentity.module &&
    identity.export === canonicalPromptTextIdentity.export
  );
}
