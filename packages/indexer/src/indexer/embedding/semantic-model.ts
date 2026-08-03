import { relative } from "node:path";
import type {
  ProjectDefinitionKind,
  ProjectIndexMediaModality,
} from "@use-crux/core/project-index";
import { safeId } from "../definitions";
import type {
  SemanticAnalyzerNode,
  SemanticAnalyzerView,
} from "../semantic/candidates";
import {
  propertyInitializer,
  semanticArrayExpression,
  semanticObjectExpression,
} from "../semantic/model/object-readers";
import {
  resolveSemanticExpression,
  semanticResolvedKey,
} from "../semantic/model/source-refs";
import {
  semanticNodeKey,
  semanticVariableNameForNode,
} from "../semantic/syntax-readers";
import { embeddingFactoryDeclarations } from "./manifest";
import { semanticIdentityDigest } from "./semantic-identity";
import {
  consumerFactoryEvidence,
  embeddingFactoryEvidence,
} from "./semantic-provenance";
import {
  isModality,
  orderedModalities,
  semanticLiteral,
  stringProperty,
} from "./semantic-values";

type Node = SemanticAnalyzerNode<SemanticAnalyzerView>;

export interface SemanticEmbeddingDescriptor {
  readonly id: string;
  readonly kind: "dense" | "sparse";
  readonly modalities?: readonly ProjectIndexMediaModality[];
  readonly identityDigest?: string;
  readonly call: Node;
  readonly config: Node;
}

export interface SemanticEmbeddingConsumer {
  readonly id: string;
  readonly kind: Extract<
    ProjectDefinitionKind,
    "rag.indexer" | "rag.retriever" | "rag.knowledgeBase"
  >;
  readonly call: Node;
  readonly config: Node;
  readonly authoredId?: string;
  readonly binding: string;
  readonly indexerId?: string;
  readonly namespace?: string;
  readonly searchStorageKey?: string;
  readonly mode: "dense" | "sparse" | "hybrid" | "unknown";
  readonly dense?: SemanticEmbeddingDescriptor;
  readonly sparse?: SemanticEmbeddingDescriptor;
}

/** Resolve a local/imported expression to a first-party embedding factory. */
export function semanticEmbeddingForExpression(
  root: string,
  expression: Node,
  view: SemanticAnalyzerView,
  seen = new Set<string>(),
): SemanticEmbeddingDescriptor | undefined {
  const key = semanticNodeKey(expression, view.syntax);
  if (seen.has(key)) return undefined;
  const nextSeen = new Set(seen).add(key);
  const unwrapped = view.syntax.unwrapExpression(expression);
  if (view.syntax.isKind(unwrapped, "callExpression")) {
    const descriptor = semanticEmbeddingForCall(root, unwrapped, view);
    if (descriptor) return descriptor;
  }
  const resolved = resolveSemanticExpression(unwrapped, view);
  return resolved?.expression
    ? semanticEmbeddingForExpression(root, resolved.expression, view, nextSeen)
    : undefined;
}

/** Resolve one call as an authored first-party embedding definition. */
export function semanticEmbeddingForCall(
  root: string,
  call: Node,
  view: SemanticAnalyzerView,
): SemanticEmbeddingDescriptor | undefined {
  const evidence = embeddingFactoryEvidence(call, view);
  if (!evidence) return undefined;
  const argument = view.syntax.callArguments(call)[evidence.configArg];
  const config = argument
    ? semanticObjectExpression(argument, view, new Set())
    : undefined;
  const binding = semanticVariableNameForNode(call, view.syntax);
  if (!config || !binding) return undefined;
  const kindExpression = propertyInitializer(config, "kind", view);
  const kind =
    evidence.adapter === "core" && kindExpression
      ? semanticLiteral(kindExpression, view)
      : "dense";
  if (kind !== "dense" && kind !== "sparse") return undefined;
  const modalities = embeddingModalities(config, evidence.adapter, view);
  const identityDigest = semanticIdentityDigest(
    config,
    kind,
    evidence.adapter,
    modalities,
    view,
  );
  const sourceFile = view.sourceFile(call).fileName;
  const localName = `${relative(root, sourceFile).replaceAll("\\", "/")}:${binding}`;
  return {
    id: `embedding:${safeId(localName)}`,
    kind,
    ...(modalities ? { modalities } : {}),
    ...(identityDigest ? { identityDigest } : {}),
    call,
    config,
  };
}

/** Resolve indexer/retriever/knowledge-base config and embedding dependencies. */
export function semanticEmbeddingConsumerForCall(
  root: string,
  call: Node,
  view: SemanticAnalyzerView,
): SemanticEmbeddingConsumer | undefined {
  const evidence = consumerFactoryEvidence(call, view);
  if (!evidence) return undefined;
  const { name } = evidence;
  const argument = view.syntax.callArguments(call)[0];
  const config = argument
    ? semanticObjectExpression(argument, view, new Set())
    : undefined;
  const binding = semanticVariableNameForNode(call, view.syntax);
  if (!config || !binding) return undefined;
  const authoredId = stringProperty(config, "id", view);
  const kind = consumerKind(name);
  const localName = `${relative(root, view.sourceFile(call).fileName).replaceAll("\\", "/")}:${binding}`;
  const id = `${kind}:${safeId(authoredId ?? (kind === "rag.indexer" ? localName : binding))}`;
  const [denseProperty, sparseProperty] =
    kind === "rag.knowledgeBase"
      ? (["embeddings", "sparseEmbeddings"] as const)
      : (["dense", "sparse"] as const);
  const denseExpression = propertyInitializer(config, denseProperty, view);
  const sparseExpression = propertyInitializer(config, sparseProperty, view);
  const dense = denseExpression
    ? semanticEmbeddingForExpression(root, denseExpression, view)
    : undefined;
  const sparse = sparseExpression
    ? semanticEmbeddingForExpression(root, sparseExpression, view)
    : undefined;
  const explicitMode = stringProperty(config, "mode", view);
  const search = propertyInitializer(config, "search", view);
  const searchConfig = search
    ? semanticObjectExpression(search, view, new Set())
    : undefined;
  const configuredMode =
    explicitMode ??
    (searchConfig ? stringProperty(searchConfig, "mode", view) : undefined);
  const mode =
    configuredMode === "dense" ||
    configuredMode === "sparse" ||
    configuredMode === "hybrid"
      ? configuredMode
      : dense && sparse
        ? "hybrid"
        : dense
          ? "dense"
          : sparse
            ? "sparse"
            : "unknown";
  return {
    id,
    kind,
    call,
    config,
    ...(authoredId ? { authoredId } : {}),
    binding,
    ...(consumerIndexerId(kind, authoredId, config, view)
      ? { indexerId: consumerIndexerId(kind, authoredId, config, view) }
      : {}),
    ...(consumerNamespace(kind, authoredId, config, view)
      ? { namespace: consumerNamespace(kind, authoredId, config, view) }
      : {}),
    ...(searchStorageKey(config, view)
      ? { searchStorageKey: searchStorageKey(config, view) }
      : {}),
    mode,
    ...(dense ? { dense } : {}),
    ...(sparse ? { sparse } : {}),
  };
}

function consumerIndexerId(
  kind: SemanticEmbeddingConsumer["kind"],
  authoredId: string | undefined,
  config: Node,
  view: SemanticAnalyzerView,
): string | undefined {
  if (kind === "rag.indexer" || kind === "rag.knowledgeBase") {
    return authoredId;
  }
  return stringProperty(config, "indexerId", view) ?? authoredId;
}

function consumerNamespace(
  kind: SemanticEmbeddingConsumer["kind"],
  authoredId: string | undefined,
  config: Node,
  view: SemanticAnalyzerView,
): string | undefined {
  if (kind !== "rag.knowledgeBase") {
    return stringProperty(config, "namespace", view);
  }
  const corpus = propertyInitializer(config, "corpus", view);
  if (!corpus) {
    return hasObjectSpread(config, view) ? undefined : authoredId;
  }
  const call = resolvedCall(corpus, view);
  if (!call || view.syntax.callExpressionName(call) !== "corpus") {
    return undefined;
  }
  const argument = view.syntax.callArguments(call)[0];
  const corpusConfig = argument
    ? semanticObjectExpression(argument, view, new Set())
    : undefined;
  return corpusConfig
    ? stringProperty(corpusConfig, "namespace", view)
    : undefined;
}

function resolvedCall(
  expression: Node,
  view: SemanticAnalyzerView,
): Node | undefined {
  const unwrapped = view.syntax.unwrapExpression(expression);
  if (view.syntax.isKind(unwrapped, "callExpression")) return unwrapped;
  const resolved = resolveSemanticExpression(unwrapped, view);
  return resolved?.expression
    ? resolvedCall(resolved.expression, view)
    : undefined;
}

function hasObjectSpread(object: Node, view: SemanticAnalyzerView): boolean {
  return view.syntax
    .objectProperties(object)
    .some((property) => view.syntax.spreadExpression(property) !== undefined);
}

function consumerKind(name: string): SemanticEmbeddingConsumer["kind"] {
  return name === "indexer"
    ? "rag.indexer"
    : name === "knowledgeBase"
      ? "rag.knowledgeBase"
      : "rag.retriever";
}

function embeddingModalities(
  config: Node,
  adapter: (typeof embeddingFactoryDeclarations)[number]["adapter"],
  view: SemanticAnalyzerView,
): readonly ProjectIndexMediaModality[] | undefined {
  const authored = propertyInitializer(config, "modalities", view);
  if (authored) {
    const array = semanticArrayExpression(authored, view, new Set());
    if (!array) return undefined;
    const values = view.syntax
      .arrayElements(array)
      .map((item) => semanticLiteral(item, view));
    return values.every(isModality)
      ? orderedModalities(values as ProjectIndexMediaModality[])
      : undefined;
  }
  if (adapter === "google") {
    return stringProperty(config, "model", view) === "gemini-embedding-2"
      ? ["text", "image", "audio", "video", "document"]
      : ["text"];
  }
  return ["text"];
}

function searchStorageKey(
  config: Node,
  view: SemanticAnalyzerView,
): string | undefined {
  const search = propertyInitializer(config, "search", view);
  const expression =
    search &&
    !view.syntax.isKind(view.syntax.unwrapExpression(search), "objectLiteral")
      ? search
      : propertyInitializer(config, "storage", view);
  if (!expression) return undefined;
  const resolved = resolveSemanticExpression(expression, view);
  return resolved
    ? semanticResolvedKey(resolved)
    : semanticNodeKey(expression, view.syntax);
}
