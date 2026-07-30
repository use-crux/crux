import type {
  SemanticAnalyzerNode,
  SemanticAnalyzerView,
  SemanticDefinitionCandidate,
} from "../../candidates";
import { semanticPropertyName } from "../../syntax-readers";

export interface SemanticPromptTextPropertySpec {
  readonly property: "system" | "prompt";
  readonly role: "system" | "prompt";
}

/** Returns manifest-compatible PromptText fields for a built-in definition. */
export function semanticPromptTextProperties(
  candidate: SemanticDefinitionCandidate,
): readonly SemanticPromptTextPropertySpec[] {
  if (candidate.kind === "prompt") {
    return [
      { property: "system", role: "system" },
      { property: "prompt", role: "prompt" },
    ];
  }
  return candidate.kind === "context"
    ? [{ property: "system", role: "system" }]
    : [];
}

/** Returns the exact initializer or method that owns a manifest field. */
export function promptTextPropertyExpression(
  object: SemanticAnalyzerNode<SemanticAnalyzerView>,
  propertyName: string,
  view: SemanticAnalyzerView,
): SemanticAnalyzerNode<SemanticAnalyzerView> | undefined {
  const property = view.syntax
    .objectProperties(object)
    .find((entry) => semanticPropertyName(entry, view.syntax) === propertyName);
  if (!property) return undefined;
  return (
    view.syntax.propertyInitializer(property) ??
    (view.syntax.isKind(property, "methodDeclaration") ? property : undefined)
  );
}
