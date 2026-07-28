import type {
  ProjectSourceRef,
  PromptTextRefactorEvidence,
} from "@use-crux/core/project-index";
import { definitionFingerprintFile } from "../../definitions";
import type {
  SemanticAnalyzerView,
  SemanticDefinitionCandidate,
} from "../candidates";
import {
  semanticExactSourceSnippetForNode,
  semanticPropertyName,
  semanticSourceForNode,
} from "../syntax-readers";
import { canonicalPromptTextIdentity } from "./prompt-text-identity";
import type { SemanticPromptTextPropertySpec } from "./prompt-text-reachability";

/**
 * Emits semantic targets for direct ordinary literals that can reuse exactly
 * one in-scope canonical Core `md` value binding.
 */
export function semanticPromptTextRefactorSourceRefs(
  root: string,
  candidate: SemanticDefinitionCandidate,
  view: SemanticAnalyzerView,
  properties: readonly SemanticPromptTextPropertySpec[],
): readonly ProjectSourceRef[] {
  const unwrapParentheses = view.syntax.unwrapParentheses;
  const isComputedProperty = view.syntax.isComputedProperty;
  const canonicalValueBindingsAt = view.canonicalValueBindingsAt;
  if (!unwrapParentheses || !isComputedProperty || !canonicalValueBindingsAt) {
    return [];
  }
  const objectProperties = view.syntax.objectProperties(candidate.object);
  if (
    objectProperties.some(
      (property) => view.syntax.spreadExpression(property) !== undefined,
    )
  ) {
    return [];
  }
  return properties.flatMap((spec) => {
    const matches = objectProperties.filter(
      (property) =>
        view.syntax.isKind(property, "propertyAssignment") &&
        !isComputedProperty(property) &&
        semanticPropertyName(property, view.syntax) === spec.property,
    );
    if (matches.length !== 1) return [];
    const initializer = view.syntax.propertyInitializer(matches[0]!);
    if (!initializer) return [];
    const literal = unwrapParentheses(initializer);
    if (!view.syntax.isKind(literal, "stringLiteral")) return [];
    const bindings = canonicalValueBindingsAt(
      literal,
      canonicalPromptTextIdentity.module,
      canonicalPromptTextIdentity.export,
    );
    if (bindings.length !== 1) return [];
    const binding = bindings[0]!;
    if (!validBinding(binding)) return [];

    const source = semanticSourceForNode(literal, view.syntax);
    const snippet = semanticExactSourceSnippetForNode(literal, view.syntax);
    const evidence: PromptTextRefactorEvidence = {
      kind: "ordinary-string-to-md",
      proof: "semantic-exact",
      lifecycle: "static",
      target: "md",
      binding,
    };
    return [
      {
        id: [
          candidate.definitionId,
          "source",
          spec.role,
          spec.property,
          "prompt-text-refactor",
          definitionFingerprintFile(root, source.file),
          source.line,
          source.column,
        ].join(":"),
        role: spec.role,
        property: spec.property,
        source,
        snippet,
        fidelity: "resolved",
        metadata: { promptTextRefactor: evidence },
      },
    ];
  });
}

function validBinding(binding: PromptTextRefactorEvidence["binding"]): boolean {
  if (
    binding.expression.length === 0 ||
    Buffer.byteLength(binding.expression, "utf8") > 256
  ) {
    return false;
  }
  const identifier = /^[$A-Z_a-z][$\w]*$/u;
  if (binding.kind === "identifier") {
    return identifier.test(binding.expression);
  }
  const parts = binding.expression.split(".");
  return (
    parts.length === 2 &&
    identifier.test(parts[0]!) &&
    identifier.test(parts[1]!)
  );
}
