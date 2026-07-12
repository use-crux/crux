import type {
  IndexLintFinding,
  MediaOperationAuthoredOptions,
  MediaOperationFacts,
  ProjectDefinition,
  ProjectRelation,
  ProjectSourceRef,
} from "@use-crux/core/project-index";
import { safeId } from "../definitions";
import {
  authoredMediaPrimitiveManifest,
  mediaOperationNames,
  mediaUnsupportedCapabilities,
} from "../media/manifest";
import { projectRelation } from "../relations";
import type {
  SemanticAnalyzerNode,
  SemanticAnalyzerSourceFile,
  SemanticAnalyzerView,
} from "./candidates";
import {
  semanticObjectExpression,
  propertyInitializer,
} from "./model/object-readers";
import { resolveSemanticExpression } from "./model/source-refs";
import { semanticTargetForExpression } from "./model/target-resolution";
import {
  semanticNodeName,
  semanticSourceForNode,
  semanticVariableNameForNode,
} from "./syntax-readers";

export interface SemanticMediaFacts {
  readonly definitions: readonly ProjectDefinition[];
  readonly sourceRefs: readonly {
    readonly definitionId: string;
    readonly ref: ProjectSourceRef;
  }[];
  readonly relations: readonly ProjectRelation[];
  readonly lintFindings: readonly IndexLintFinding[];
}

const operations = new Set<MediaOperationFacts["operation"]>(
  mediaOperationNames,
);
const routingRelation = authoredMediaPrimitiveManifest.relations.find(
  ([, property]) => property === "routing",
)?.[0];

/** Projects authored media calls through backend-neutral compiler evidence. */
export function semanticMediaFacts(
  sourceFiles: readonly SemanticAnalyzerSourceFile<SemanticAnalyzerView>[],
  view: SemanticAnalyzerView,
): SemanticMediaFacts {
  const definitions: ProjectDefinition[] = [];
  const sourceRefs: { definitionId: string; ref: ProjectSourceRef }[] = [];
  const relations: ProjectRelation[] = [];
  const lintFindings: IndexLintFinding[] = [];
  for (const sourceFile of sourceFiles) {
    for (const call of descendants(sourceFile, view)) {
      if (!view.syntax.isKind(call, "callExpression")) continue;
      const operation = resolvedMediaOperation(call, view);
      if (!operation) continue;
      const [argument] = view.syntax.callArguments(call);
      const config = argument
        ? semanticObjectExpression(argument, view, new Set())
        : undefined;
      if (!config) continue;
      const modalities = mediaModalities(config, view);
      if (
        (operation === "generate" || operation === "stream") &&
        modalities.length === 0
      )
        continue;
      const name = semanticVariableNameForNode(call, view.syntax);
      if (!name) continue;
      const id = `media.operation:${safeId(name)}`;
      const adapter = stringProperty(config, "adapter", view);
      const facts = operationFacts(operation, config, modalities, view);
      definitions.push({
        id,
        kind: "media.operation",
        name,
        source: semanticSourceForNode(call, view.syntax),
        fidelity: "resolved",
        status: "active",
        metadata: { facts, indexPresentation: { standalone: true } },
      });
      if (
        argument &&
        !view.syntax.isKind(
          view.syntax.unwrapExpression(argument),
          "objectLiteral",
        )
      ) {
        const source = semanticSourceForNode(argument, view.syntax);
        sourceRefs.push({
          definitionId: id,
          ref: {
            id: `${id}:config:${source.line}:${source.column}`,
            role: "config",
            property: "options",
            source,
            fidelity: "resolved",
          },
        });
      }
      const model = propertyInitializer(config, "model", view);
      const target = model
        ? semanticTargetForExpression(model, view)
        : undefined;
      if (routingRelation && target?.kind.startsWith("routing.")) {
        relations.push(
          projectRelation({
            type: routingRelation,
            from: id,
            to: target.id,
            fidelity: "resolved",
            source: semanticSourceForNode(model!, view.syntax),
          }),
        );
      }
      const misuse = mediaMisuse(config, adapter, operation, view);
      if (misuse.unsupportedCapability)
        lintFindings.push(
          mediaFinding(
            "media.unsupported-capability",
            "error",
            id,
            facts,
            call,
            view,
          ),
        );
      if (misuse.providerFile)
        lintFindings.push(
          mediaFinding(
            "media.invalid-provider-file",
            "error",
            id,
            facts,
            call,
            view,
          ),
        );
      if (misuse.assetRef)
        lintFindings.push(
          mediaFinding(
            "media.asset-ref-not-hydrated",
            "error",
            id,
            facts,
            call,
            view,
          ),
        );
      if (misuse.rawRetention)
        lintFindings.push(
          mediaFinding("media.raw-retention", "warning", id, facts, call, view),
        );
      if (outputIsDiscarded(call, name, sourceFiles, view)) {
        lintFindings.push(
          mediaFinding(
            "media.output-discarded",
            "warning",
            id,
            facts,
            call,
            view,
          ),
        );
      }
    }
  }
  return {
    definitions: definitions.sort((a, b) => a.id.localeCompare(b.id)),
    sourceRefs: sourceRefs.sort((a, b) => a.ref.id.localeCompare(b.ref.id)),
    relations: relations.sort((a, b) => a.id.localeCompare(b.id)),
    lintFindings: lintFindings.sort((a, b) => a.id.localeCompare(b.id)),
  };
}

function resolvedMediaOperation(
  call: SemanticAnalyzerNode<SemanticAnalyzerView>,
  view: SemanticAnalyzerView,
) {
  const target = view.syntax.callExpressionTarget(call);
  return target ? operationForExpression(target, view, new Set()) : undefined;
}

function operationForExpression(
  expression: SemanticAnalyzerNode<SemanticAnalyzerView>,
  view: SemanticAnalyzerView,
  seen: Set<string>,
): MediaOperationFacts["operation"] | undefined {
  const key = `${view.sourceFile(expression).fileName}:${expression.pos}:${expression.end}`;
  if (seen.has(key)) return undefined;
  seen.add(key);
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
  if (localSymbol) {
    for (const declaration of view.declarationsOf([localSymbol])[0] ?? []) {
      const imported = importedOperation(declaration, view);
      if (imported) return imported;
    }
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
  let importedFromCrux = false;
  for (
    let current: SemanticAnalyzerNode<SemanticAnalyzerView> | undefined =
      declaration;
    current;
    current = view.syntax.parent(current)
  ) {
    if (!view.syntax.isKind(current, "importDeclaration")) continue;
    importedFromCrux = (
      view.syntax.importModuleSpecifier(current) ?? ""
    ).startsWith("@use-crux/");
    break;
  }
  if (!importedFromCrux) return undefined;
  return descendants(declaration, view)
    .map((node) => semanticNodeName(node, view.syntax))
    .find((name): name is MediaOperationFacts["operation"] =>
      operations.has(name as MediaOperationFacts["operation"]),
    );
}

function isApprovedMediaDeclaration(
  node: SemanticAnalyzerNode<SemanticAnalyzerView>,
  view: SemanticAnalyzerView,
): boolean {
  const file = view.sourceFile(node).fileName.replaceAll("\\", "/");
  if (
    /\/(?:node_modules\/@use-crux|packages\/(?:core|ai|openai|google|anthropic|convex|ingest))\//.test(
      file,
    )
  )
    return true;
  for (
    let current: SemanticAnalyzerNode<SemanticAnalyzerView> | undefined = node;
    current;
    current = view.syntax.parent(current)
  ) {
    if (view.syntax.isKind(current, "importDeclaration")) {
      return (view.syntax.importModuleSpecifier(current) ?? "").startsWith(
        "@use-crux/",
      );
    }
  }
  return false;
}

function operationFacts(
  operation: MediaOperationFacts["operation"],
  config: SemanticAnalyzerNode<SemanticAnalyzerView>,
  modalities: readonly ("text" | "image" | "audio" | "video" | "document")[],
  view: SemanticAnalyzerView,
): MediaOperationFacts {
  const authoredOptions = options(config, view);
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
    ...optional("adapter", stringProperty(config, "adapter", view)),
    ...optional("model", stringProperty(config, "model", view)),
    execution: execution(config, view),
    ...(Object.keys(authoredOptions).length ? { authoredOptions } : {}),
  };
}

function options(
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
    ...optional("taskType", stringProperty(config, "taskType", view)),
    ...optional("voice", stringProperty(config, "voice", view)),
  };
}

function mediaModalities(
  node: SemanticAnalyzerNode<SemanticAnalyzerView>,
  view: SemanticAnalyzerView,
) {
  const found = new Set<"text" | "image" | "audio" | "video" | "document">();
  for (const item of descendants(node, view)) {
    const parent = view.syntax.parent(item);
    if (!parent || !view.syntax.isKind(parent, "propertyAssignment")) continue;
    const property = view.syntax.propertyName(parent);
    const name = property ? semanticNodeName(property, view.syntax) : undefined;
    const value = view.syntax.literalValue(view.syntax.unwrapExpression(item));
    if ((name === "type" || name === "kind") && typeof value === "string") {
      const modality = value === "file" ? "document" : value;
      if (["text", "image", "audio", "video", "document"].includes(modality))
        found.add(modality as typeof found extends Set<infer T> ? T : never);
    }
  }
  return ["text", "image", "audio", "video", "document"].filter((item) =>
    found.has(item as never),
  ) as Array<"text" | "image" | "audio" | "video" | "document">;
}

function mediaMisuse(
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
      if (provider && adapter && provider !== adapter) providerFile = true;
    }
  }
  const unsupported = mediaUnsupportedCapabilities.some(
    (capability) =>
      capability.adapter === adapter &&
      capability.operations.some((item) => item === operation),
  );
  return {
    providerFile,
    assetRef,
    rawRetention,
    unsupportedCapability: unsupported,
  };
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

function outputIsDiscarded(
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

function mediaFinding(
  ruleId: string,
  severity: "error" | "warning",
  definitionId: string,
  facts: MediaOperationFacts,
  node: SemanticAnalyzerNode<SemanticAnalyzerView>,
  view: SemanticAnalyzerView,
): IndexLintFinding {
  const source = semanticSourceForNode(node, view.syntax);
  return {
    id: `${ruleId}:${definitionId}:${source.line}:${source.column}`,
    ruleId,
    severity,
    category: "quality",
    maturity: "experimental",
    confidence: "high",
    profiles: ["recommended", "strict"],
    title: ruleId,
    message: `Authored media evidence triggered ${ruleId}.`,
    rationale:
      "The compiler proved this condition from resolved authored source.",
    impact: "The media operation may fail or its result may be lost.",
    source,
    primaryDefinitionId: definitionId,
    relatedDefinitionIds: [],
    evidence: [
      {
        kind: "source",
        label: "Resolved media evidence",
        source,
        data: {
          source: "semantic",
          fidelity: "resolved",
          capability: facts.operation,
          ...(facts.adapter ? { adapter: facts.adapter } : {}),
          ...(facts.model ? { model: facts.model } : {}),
        },
      },
    ],
    fixes: [
      {
        title: "Correct the media operation",
        description:
          "Hydrate or route the media value and consume the canonical result fields.",
        kind: "manual",
      },
    ],
    docsUrl: "https://cruxjs.dev/docs/guides/multimodal",
  };
}

function descendants(
  root: SemanticAnalyzerNode<SemanticAnalyzerView>,
  view: SemanticAnalyzerView,
) {
  const out: SemanticAnalyzerNode<SemanticAnalyzerView>[] = [];
  const visit = (node: SemanticAnalyzerNode<SemanticAnalyzerView>) => {
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
) {
  const value = literalProperty(node, name, view);
  return typeof value === "string" ? value : undefined;
}
function numberProperty(
  node: SemanticAnalyzerNode<SemanticAnalyzerView>,
  name: string,
  view: SemanticAnalyzerView,
) {
  const value = literalProperty(node, name, view);
  return typeof value === "number" ? value : undefined;
}
function booleanProperty(
  node: SemanticAnalyzerNode<SemanticAnalyzerView>,
  name: string,
  view: SemanticAnalyzerView,
) {
  const value = literalProperty(node, name, view);
  return typeof value === "boolean" ? value : undefined;
}
function execution(
  node: SemanticAnalyzerNode<SemanticAnalyzerView>,
  view: SemanticAnalyzerView,
): MediaOperationFacts["execution"] {
  const value = stringProperty(node, "execution", view);
  return value === "native" || value === "composed" ? value : "unknown";
}
function optional<const K extends string, V>(
  key: K,
  value: V | undefined,
): { [P in K]?: V } {
  return value === undefined ? {} : ({ [key]: value } as { [P in K]?: V });
}
