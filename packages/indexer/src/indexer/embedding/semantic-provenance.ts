import type {
  SemanticAnalyzerNode,
  SemanticAnalyzerView,
} from "../semantic/candidates";
import { semanticNodeName } from "../semantic/syntax-readers";
import { embeddingFactoryDeclarations } from "./manifest";

type Node = SemanticAnalyzerNode<SemanticAnalyzerView>;

/** Resolves import and local-alias provenance for a first-party embedding factory call. */
export function embeddingFactoryEvidence(
  call: Node,
  view: SemanticAnalyzerView,
): (typeof embeddingFactoryDeclarations)[number] | undefined {
  const target = view.syntax.callExpressionTarget(call);
  return target ? embeddingFactoryForExpression(target, view) : undefined;
}

/** Resolves import and local-alias provenance for a first-party vector consumer factory. */
export function consumerFactoryEvidence(
  call: Node,
  view: SemanticAnalyzerView,
): { readonly name: "indexer" | "retriever" | "knowledgeBase" } | undefined {
  const target = view.syntax.callExpressionTarget(call);
  return target ? consumerFactoryForExpression(target, view) : undefined;
}

function embeddingFactoryForExpression(
  expression: Node,
  view: SemanticAnalyzerView,
): (typeof embeddingFactoryDeclarations)[number] | undefined {
  const module = importModuleForExpression(expression, view);
  const candidate = embeddingFactoryDeclarations.find(
    (item) => item.module === module,
  );
  return candidate && importDeclaresName(expression, candidate.call, view)
    ? candidate
    : undefined;
}

function consumerFactoryForExpression(
  expression: Node,
  view: SemanticAnalyzerView,
): { readonly name: "indexer" | "retriever" | "knowledgeBase" } | undefined {
  const module = importModuleForExpression(expression, view);
  for (const name of ["indexer", "retriever", "knowledgeBase"] as const) {
    if (
      module &&
      consumerModules(name).includes(module) &&
      importDeclaresName(expression, name, view)
    ) {
      return { name };
    }
  }
  return undefined;
}

function importModuleForExpression(
  expression: Node,
  view: SemanticAnalyzerView,
): string | undefined {
  const symbol = view.symbolsAt([expression])[0];
  for (const declaration of symbol
    ? (view.declarationsOf([symbol])[0] ?? [])
    : []) {
    for (
      let current: Node | undefined = declaration;
      current;
      current = view.syntax.parent(current)
    ) {
      if (view.syntax.isKind(current, "importDeclaration")) {
        return view.syntax.importModuleSpecifier(current);
      }
    }
  }
  return undefined;
}

function importDeclaresName(
  expression: Node,
  name: string,
  view: SemanticAnalyzerView,
): boolean {
  const symbol = view.symbolsAt([expression])[0];
  const declarations = symbol ? (view.declarationsOf([symbol])[0] ?? []) : [];
  return declarations.some((declaration) =>
    descendantsOf(declaration, view).some(
      (node) => semanticNodeName(node, view.syntax) === name,
    ),
  );
}

function descendantsOf(
  root: Node,
  view: SemanticAnalyzerView,
): readonly Node[] {
  return [
    root,
    ...view.childNodes(root).flatMap((child) => descendantsOf(child, view)),
  ];
}

function consumerModules(
  name: "indexer" | "retriever" | "knowledgeBase",
): readonly string[] {
  return name === "indexer"
    ? ["@use-crux/core/indexing", "@use-crux/core"]
    : ["@use-crux/core/retrieval", "@use-crux/core"];
}
