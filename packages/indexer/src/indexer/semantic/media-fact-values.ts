import type {
  MediaOperationAuthoredOptions,
  MediaOperationFacts,
} from "@use-crux/core/project-index";
import { mediaUnsupportedCapabilities } from "../media/manifest";
import type {
  SemanticAnalyzerNode,
  SemanticAnalyzerSourceFile,
  SemanticAnalyzerView,
} from "./candidates";
import {
  propertyInitializer,
  semanticObjectExpression,
} from "./model/object-readers";
import { semanticNodeName } from "./syntax-readers";

type MediaModality = "text" | "image" | "audio" | "video" | "document";

/** Build privacy-safe authored operation facts from resolved config evidence. */
export function semanticMediaOperationFacts(
  operation: MediaOperationFacts["operation"],
  config: SemanticAnalyzerNode<SemanticAnalyzerView>,
  modalities: readonly MediaModality[],
  adapter: string | undefined,
  view: SemanticAnalyzerView,
): MediaOperationFacts {
  const authoredOptions = mediaAuthoredOptions(config, view);
  return {
    kind: "media.operation",
    operation,
    ...(operation === "generateImage"
      ? { outputModalities: ["image"] as const }
      : operation === "transcribe"
        ? {
            inputModalities: ["audio"] as const,
            outputModalities: ["text"] as const,
          }
        : operation === "generateSpeech"
          ? {
              inputModalities: ["text"] as const,
              outputModalities: ["audio"] as const,
            }
          : {
              ...(modalities.length ? { inputModalities: modalities } : {}),
              outputModalities: ["text"] as const,
            }),
    ...optional("adapter", adapter),
    ...optional("model", stringProperty(config, "model", view)),
    execution: "unknown",
    ...(Object.keys(authoredOptions).length ? { authoredOptions } : {}),
  };
}

/** Return media modalities conclusively authored in the selected operation config. */
export function semanticMediaModalities(
  node: SemanticAnalyzerNode<SemanticAnalyzerView>,
  view: SemanticAnalyzerView,
): readonly MediaModality[] {
  const found = new Set<MediaModality>();
  for (const item of descendants(node, view)) {
    const parent = view.syntax.parent(item);
    if (!parent || !view.syntax.isKind(parent, "propertyAssignment")) continue;
    const property = view.syntax.propertyName(parent);
    const name = property ? semanticNodeName(property, view.syntax) : undefined;
    const value = view.syntax.literalValue(view.syntax.unwrapExpression(item));
    if ((name === "type" || name === "kind") && typeof value === "string") {
      const modality = value === "file" ? "document" : value;
      if (isMediaModality(modality)) found.add(modality);
    }
  }
  return ["text", "image", "audio", "video", "document"].filter((item) =>
    found.has(item as MediaModality),
  ) as readonly MediaModality[];
}

/** Deterministic misuse evidence derived only from public operation config. */
export function semanticMediaMisuse(
  node: SemanticAnalyzerNode<SemanticAnalyzerView>,
  adapter: string | undefined,
  operation: MediaOperationFacts["operation"],
  view: SemanticAnalyzerView,
) {
  let providerFile = false;
  let assetRef = false;
  const rawRetention = ["observability", "vectorMetadata"].some((property) => {
    const retained = propertyInitializer(node, property, view);
    return retained ? containsRawMediaProperty(retained, view) : false;
  });
  for (const item of descendants(node, view)) {
    if (!view.syntax.isKind(item, "objectLiteral")) continue;
    const type = stringProperty(item, "type", view);
    if (type === "asset-ref") assetRef = true;
    if (type === "provider-file") {
      const provider = stringProperty(item, "provider", view);
      if (
        provider &&
        adapter &&
        adapter !== "ai-sdk" &&
        adapter !== "convex" &&
        provider !== adapter
      )
        providerFile = true;
    }
  }
  const unsupportedCapability = mediaUnsupportedCapabilities.some(
    (capability) =>
      capability.adapter === adapter &&
      capability.operations.some((item) => item === operation),
  );
  return { providerFile, assetRef, rawRetention, unsupportedCapability };
}

/** Return whether a named media result is never consumed for canonical output. */
export function semanticMediaOutputIsDiscarded(
  call: SemanticAnalyzerNode<SemanticAnalyzerView>,
  name: string,
  sourceFiles: readonly SemanticAnalyzerSourceFile<SemanticAnalyzerView>[],
  view: SemanticAnalyzerView,
): boolean {
  const declaration = view.syntax.parent(call);
  if (!declaration || !view.syntax.isKind(declaration, "variableDeclaration"))
    return false;
  const nameNode = view.syntax.variableDeclarationName(declaration);
  const symbol = nameNode ? view.symbolsAt([nameNode])[0] : undefined;
  if (!symbol) return false;
  let references = 0;
  for (const sourceFile of sourceFiles)
    for (const node of descendants(sourceFile, view)) {
      if (
        !view.syntax.isKind(node, "identifier") ||
        view.syntax.identifierText(node) !== name ||
        node === nameNode
      )
        continue;
      if (view.resolvedSymbols([node])[0] !== symbol) continue;
      references += 1;
      const parent = view.syntax.parent(node);
      if (
        parent &&
        view.syntax.isKind(parent, "propertyAccessExpression") &&
        ["content", "messages"].includes(
          view.syntax.propertyAccessName(parent) ?? "",
        )
      )
        return false;
    }
  return references === 0;
}

function mediaAuthoredOptions(
  config: SemanticAnalyzerNode<SemanticAnalyzerView>,
  view: SemanticAnalyzerView,
): MediaOperationAuthoredOptions {
  return {
    ...optional("n", numberProperty(config, "n", view)),
    ...optional("size", stringProperty(config, "size", view)),
    ...optional("aspectRatio", stringProperty(config, "aspectRatio", view)),
    ...optional("seed", numberProperty(config, "seed", view)),
    ...optional("timestamps", stringProperty(config, "timestamps", view)),
    ...optional("diarization", booleanProperty(config, "diarization", view)),
    ...optional("task", transcriptionTask(config, view)),
    ...optional("voice", stringProperty(config, "voice", view)),
  };
}

function transcriptionTask(
  config: SemanticAnalyzerNode<SemanticAnalyzerView>,
  view: SemanticAnalyzerView,
): MediaOperationAuthoredOptions["task"] {
  const task = propertyInitializer(config, "task", view);
  if (!task) return undefined;
  if (
    view.syntax.literalValue(view.syntax.unwrapExpression(task)) ===
    "transcribe"
  )
    return "transcribe";
  const translate = semanticObjectExpression(task, view, new Set());
  return translate && stringProperty(translate, "type", view) === "translate"
    ? "translate"
    : undefined;
}

function containsRawMediaProperty(
  node: SemanticAnalyzerNode<SemanticAnalyzerView>,
  view: SemanticAnalyzerView,
): boolean {
  return descendants(node, view).some((item) => {
    if (!view.syntax.isKind(item, "propertyAssignment")) return false;
    const nameNode = view.syntax.propertyName(item);
    const name = nameNode ? semanticNodeName(nameNode, view.syntax) : undefined;
    return name === "rawMedia" || name === "rawAsset";
  });
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

function literalProperty(
  node: SemanticAnalyzerNode<SemanticAnalyzerView>,
  name: string,
  view: SemanticAnalyzerView,
) {
  const value = propertyInitializer(node, name, view);
  return value
    ? view.syntax.literalValue(view.syntax.unwrapExpression(value))
    : undefined;
}

function stringProperty(
  node: SemanticAnalyzerNode<SemanticAnalyzerView>,
  name: string,
  view: SemanticAnalyzerView,
): string | undefined {
  const value = literalProperty(node, name, view);
  return typeof value === "string" ? value : undefined;
}

function numberProperty(
  node: SemanticAnalyzerNode<SemanticAnalyzerView>,
  name: string,
  view: SemanticAnalyzerView,
): number | undefined {
  const value = literalProperty(node, name, view);
  return typeof value === "number" ? value : undefined;
}

function booleanProperty(
  node: SemanticAnalyzerNode<SemanticAnalyzerView>,
  name: string,
  view: SemanticAnalyzerView,
): boolean | undefined {
  const value = literalProperty(node, name, view);
  return typeof value === "boolean" ? value : undefined;
}

function isMediaModality(value: string): value is MediaModality {
  return ["text", "image", "audio", "video", "document"].includes(value);
}

function optional<const K extends string, V>(
  key: K,
  value: V | undefined,
): { [P in K]?: V } {
  return value === undefined ? {} : ({ [key]: value } as { [P in K]?: V });
}
