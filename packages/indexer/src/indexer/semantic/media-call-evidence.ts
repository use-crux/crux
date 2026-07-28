import type { MediaOperationFacts } from "@use-crux/core/project-index";
import {
  mediaOperationConfigArguments,
  mediaOperationNames,
} from "../media/manifest";
import type { SemanticAnalyzerNode, SemanticAnalyzerView } from "./candidates";
import { resolveSemanticExpression } from "./model/source-refs";
import { semanticNodeName } from "./syntax-readers";

/** Resolved public media call shape consumed by backend-neutral projection. */
export interface SemanticMediaCallEvidence {
  readonly operation: MediaOperationFacts["operation"];
  readonly configArgument: number;
  readonly adapter?: string;
}

const operations = new Set<MediaOperationFacts["operation"]>(
  mediaOperationNames,
);

const directOperations = {
  "ai-sdk": [
    "generate",
    "stream",
    "generateImage",
    "transcribe",
    "generateSpeech",
  ],
  convex: ["generateImage", "transcribe", "generateSpeech"],
} as const satisfies Partial<
  Record<string, readonly MediaOperationFacts["operation"][]>
>;

const boundOperations = {
  openai: [
    "generate",
    "stream",
    "generateImage",
    "streamImage",
    "transcribe",
    "generateSpeech",
    "streamSpeech",
  ],
  google: [
    "generate",
    "stream",
    "generateImage",
    "streamImage",
    "transcribe",
    "generateSpeech",
    "streamSpeech",
  ],
  anthropic: ["generate", "stream"],
} as const satisfies Partial<
  Record<string, readonly MediaOperationFacts["operation"][]>
>;

/** Resolve operation identity, positional config shape, and provable adapter provenance. */
export function semanticMediaCallEvidence(
  call: SemanticAnalyzerNode<SemanticAnalyzerView>,
  view: SemanticAnalyzerView,
): SemanticMediaCallEvidence | undefined {
  const target = view.syntax.callExpressionTarget(call);
  if (!target) return undefined;
  const adapter = adapterForExpression(target, view, new Set());
  const operation =
    operationForExpression(target, view, new Set()) ??
    boundOperation(target, adapter, view);
  if (!operation) return undefined;
  return {
    operation,
    configArgument: mediaOperationConfigArguments[operation],
    ...(adapter ? { adapter } : {}),
  };
}

function boundOperation(
  target: SemanticAnalyzerNode<SemanticAnalyzerView>,
  adapter: string | undefined,
  view: SemanticAnalyzerView,
): MediaOperationFacts["operation"] | undefined {
  if (!adapter || !view.syntax.isKind(target, "propertyAccessExpression"))
    return undefined;
  const operation = view.syntax.propertyAccessName(target);
  if (!operations.has(operation as MediaOperationFacts["operation"]))
    return undefined;
  const supported = boundOperations[adapter as keyof typeof boundOperations];
  return supported?.includes(operation as never)
    ? (operation as MediaOperationFacts["operation"])
    : undefined;
}

function operationForExpression(
  expression: SemanticAnalyzerNode<SemanticAnalyzerView>,
  view: SemanticAnalyzerView,
  seen: Set<string>,
): MediaOperationFacts["operation"] | undefined {
  const key = nodeKey(expression, view);
  if (seen.has(key)) return undefined;
  seen.add(key);
  const unwrapped = view.syntax.unwrapExpression(expression);
  if (view.syntax.isKind(unwrapped, "propertyAccessExpression")) {
    const name = view.syntax.propertyAccessName(unwrapped);
    const nameNode = view.syntax.propertyAccessNameNode(unwrapped);
    if (nameNode && operations.has(name as MediaOperationFacts["operation"])) {
      const propertySymbol = view.resolvedSymbols([nameNode])[0];
      const declarations = propertySymbol
        ? (view.declarationsOf([propertySymbol])[0] ?? [])
        : [];
      if (
        declarations.some((declaration) =>
          isApprovedMediaDeclaration(declaration, view),
        )
      ) {
        return name as MediaOperationFacts["operation"];
      }
    }
  }
  const symbol = view.resolvedSymbols([expression])[0];
  if (
    symbol &&
    operations.has(symbol.name as MediaOperationFacts["operation"])
  ) {
    const declarations = view.declarationsOf([symbol])[0] ?? [];
    if (
      declarations.some((declaration) =>
        isApprovedMediaDeclaration(declaration, view),
      )
    ) {
      return symbol.name as MediaOperationFacts["operation"];
    }
  }
  const localSymbol = view.symbolsAt([expression])[0];
  for (const declaration of localSymbol
    ? (view.declarationsOf([localSymbol])[0] ?? [])
    : []) {
    const imported = importedOperation(declaration, view);
    if (imported) return imported;
  }
  const resolved = resolveSemanticExpression(expression, view);
  return resolved?.expression
    ? operationForExpression(resolved.expression, view, seen)
    : undefined;
}

function importedOperation(
  declaration: SemanticAnalyzerNode<SemanticAnalyzerView>,
  view: SemanticAnalyzerView,
): MediaOperationFacts["operation"] | undefined {
  let moduleSpecifier: string | undefined;
  let current: SemanticAnalyzerNode<SemanticAnalyzerView> | undefined =
    declaration;
  while (current) {
    if (view.syntax.isKind(current, "importDeclaration")) {
      moduleSpecifier = view.syntax.importModuleSpecifier(current);
      break;
    }
    current = view.syntax.parent(current);
  }
  if (!adapterForModule(moduleSpecifier)) return undefined;
  return descendants(declaration, view)
    .map((node) => semanticNodeName(node, view.syntax))
    .find(
      (name): name is MediaOperationFacts["operation"] =>
        operations.has(name as MediaOperationFacts["operation"]) &&
        operationIsDirectExport(
          moduleSpecifier,
          name as MediaOperationFacts["operation"],
        ),
    );
}

function operationIsDirectExport(
  moduleSpecifier: string | undefined,
  operation: MediaOperationFacts["operation"],
): boolean {
  const adapter = adapterForModule(moduleSpecifier);
  const supported = adapter
    ? directOperations[adapter as keyof typeof directOperations]
    : undefined;
  return supported?.includes(operation as never) ?? false;
}

function adapterForExpression(
  expression: SemanticAnalyzerNode<SemanticAnalyzerView>,
  view: SemanticAnalyzerView,
  seen: Set<string>,
): string | undefined {
  const key = nodeKey(expression, view);
  if (seen.has(key)) return undefined;
  seen.add(key);
  const imported = importModuleForExpression(expression, view);
  const direct = adapterForModule(imported);
  if (direct) return direct;

  const unwrapped = view.syntax.unwrapExpression(expression);
  if (view.syntax.isKind(unwrapped, "propertyAccessExpression")) {
    const receiver = view.syntax.propertyAccessExpression(unwrapped);
    const fromReceiver = receiver
      ? adapterForExpression(receiver, view, seen)
      : undefined;
    if (fromReceiver) return fromReceiver;
  }
  if (view.syntax.isKind(unwrapped, "callExpression")) {
    const target = view.syntax.callExpressionTarget(unwrapped);
    const fromFactory = target
      ? adapterForExpression(target, view, seen)
      : undefined;
    if (fromFactory) return fromFactory;
  }
  const resolved = resolveSemanticExpression(unwrapped, view);
  return resolved?.expression
    ? adapterForExpression(resolved.expression, view, seen)
    : undefined;
}

function importModuleForExpression(
  expression: SemanticAnalyzerNode<SemanticAnalyzerView>,
  view: SemanticAnalyzerView,
): string | undefined {
  const symbol = view.symbolsAt([expression])[0];
  for (const declaration of symbol
    ? (view.declarationsOf([symbol])[0] ?? [])
    : []) {
    for (
      let current: SemanticAnalyzerNode<SemanticAnalyzerView> | undefined =
        declaration;
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

function isApprovedMediaDeclaration(
  node: SemanticAnalyzerNode<SemanticAnalyzerView>,
  view: SemanticAnalyzerView,
): boolean {
  const file = view.sourceFile(node).fileName.replaceAll("\\", "/");
  return /\/(?:node_modules\/@use-crux|packages\/(?:core|ai|openai|google|anthropic|convex|ingest))\//.test(
    file,
  );
}

function adapterForModule(
  moduleSpecifier: string | undefined,
): string | undefined {
  switch (moduleSpecifier) {
    case "@use-crux/ai":
      return "ai-sdk";
    case "@use-crux/openai":
      return "openai";
    case "@use-crux/google":
      return "google";
    case "@use-crux/anthropic":
      return "anthropic";
    case "@use-crux/convex":
      return "convex";
    default:
      return undefined;
  }
}

function nodeKey(
  node: SemanticAnalyzerNode<SemanticAnalyzerView>,
  view: SemanticAnalyzerView,
): string {
  return `${view.sourceFile(node).fileName}:${node.pos}:${node.end}`;
}

function descendants(
  root: SemanticAnalyzerNode<SemanticAnalyzerView>,
  view: SemanticAnalyzerView,
): readonly SemanticAnalyzerNode<SemanticAnalyzerView>[] {
  const out: SemanticAnalyzerNode<SemanticAnalyzerView>[] = [];
  const visit = (node: SemanticAnalyzerNode<SemanticAnalyzerView>): void => {
    out.push(node);
    view.childNodes(node).forEach(visit);
  };
  visit(root);
  return out;
}
