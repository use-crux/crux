import { relative } from "node:path";
import type {
  EmbeddingCallFacts,
  ProjectIndexMediaModality,
} from "@use-crux/core/project-index";
import { safeId } from "../definitions";
import type {
  SemanticAnalyzerNode,
  SemanticAnalyzerSourceFile,
  SemanticAnalyzerView,
} from "../semantic/candidates";
import {
  propertyInitializer,
  semanticArrayExpression,
  semanticObjectExpression,
} from "../semantic/model/object-readers";
import { resolveSemanticExpression } from "../semantic/model/source-refs";
import { semanticSourceForNode } from "../semantic/syntax-readers";

type Node = SemanticAnalyzerNode<SemanticAnalyzerView>;

/** Collects semantic nodes in stable source traversal order. */
export function semanticDescendants(
  sourceFiles: readonly SemanticAnalyzerSourceFile<SemanticAnalyzerView>[],
  view: SemanticAnalyzerView,
): readonly Node[] {
  return sourceFiles.flatMap((sourceFile) => {
    const nodes: Node[] = [];
    const visit = (node: Node): void => {
      nodes.push(node);
      view.childNodes(node).forEach(visit);
    };
    visit(sourceFile);
    return nodes;
  });
}

/** Infers modalities only from fully resolved literal authored input. */
export function semanticInputModalities(
  expression: Node | undefined,
  view: SemanticAnalyzerView,
): readonly ProjectIndexMediaModality[] | undefined {
  if (!expression) return undefined;
  const literal = semanticLiteral(expression, view);
  if (typeof literal === "string") return ["text"];
  const array = semanticArrayExpression(expression, view, new Set());
  if (array) {
    const values = view.syntax
      .arrayElements(array)
      .map((item) => semanticInputModalities(item, view));
    if (values.some((value) => value === undefined)) return undefined;
    return orderedModalities(values.flatMap((value) => value ?? []));
  }
  const object = semanticObjectExpression(expression, view, new Set());
  if (!object) return undefined;
  const type = stringProperty(object, "type", view);
  if (isModality(type)) return [type];
  if (type === "file") return ["document"];
  const inferred = mediaTypeModality(stringProperty(object, "mediaType", view));
  return inferred ? [inferred] : undefined;
}

/** Builds byte-safe facts for one authored embedding invocation. */
export function embeddingCallFacts(
  operation: EmbeddingCallFacts["operation"],
  modalities: readonly ProjectIndexMediaModality[] | undefined,
  role: EmbeddingCallFacts["role"] | undefined,
): EmbeddingCallFacts {
  return {
    kind: "embedding.call",
    operation,
    ...(modalities ? { modalities } : {}),
    ...(role ? { role } : {}),
  };
}

/** Creates the stable module-relative identity segment for a semantic callsite. */
export function sourceLocationId(
  root: string,
  node: Node,
  view: SemanticAnalyzerView,
): string {
  const source = semanticSourceForNode(node, view.syntax);
  const file = relative(root, source.file).replaceAll("\\", "/");
  return safeId(`${file}:${source.line}:${source.column}`);
}

/** Reads a resolved literal string property without evaluating source. */
export function stringProperty(
  object: Node,
  property: string,
  view: SemanticAnalyzerView,
): string | undefined {
  const value = propertyInitializer(object, property, view);
  const literal = value ? semanticLiteral(value, view) : undefined;
  return typeof literal === "string" ? literal : undefined;
}

/** Reads a literal through conservative local/imported alias resolution. */
export function semanticLiteral(
  expression: Node,
  view: SemanticAnalyzerView,
): unknown {
  const unwrapped = view.syntax.unwrapExpression(expression);
  const direct = view.syntax.literalValue(unwrapped);
  if (direct !== undefined) return direct;
  const resolved = resolveSemanticExpression(unwrapped, view);
  return resolved?.expression
    ? semanticLiteral(resolved.expression, view)
    : undefined;
}

export function isModality(value: unknown): value is ProjectIndexMediaModality {
  return ["text", "image", "audio", "video", "document"].includes(
    value as string,
  );
}

export function orderedModalities(
  values: readonly ProjectIndexMediaModality[],
): readonly ProjectIndexMediaModality[] {
  const set = new Set(values);
  return ["text", "image", "audio", "video", "document"].filter((value) =>
    set.has(value as ProjectIndexMediaModality),
  ) as ProjectIndexMediaModality[];
}

/** Maps a literal MIME type to the embedding modality used by bare assets. */
export function mediaTypeModality(
  mediaType: string | undefined,
): Exclude<ProjectIndexMediaModality, "text"> | undefined {
  const normalized = mediaType?.split(";", 1)[0]?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized.startsWith("image/")) return "image";
  if (normalized.startsWith("audio/")) return "audio";
  if (normalized.startsWith("video/")) return "video";
  return "document";
}
