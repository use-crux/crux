import type {
  EmbeddingFacts,
  EmbeddingIdentityInputs,
  ProjectIndexMediaModality,
} from "@use-crux/core/project-index";
import type {
  SemanticAnalyzerNode,
  SemanticAnalyzerView,
} from "../semantic/candidates";
import { propertyInitializer } from "../semantic/model/object-readers";
import { resolvedEmbeddingIdentity } from "./fingerprint";
import { googleEmbeddingDefaults, openAIEmbeddingDimensions } from "./manifest";
import { semanticLiteral, stringProperty } from "./semantic-values";

type Node = SemanticAnalyzerNode<SemanticAnalyzerView>;
type Adapter = NonNullable<EmbeddingFacts["adapter"]>;

/** Returns an exact runtime-compatible identity digest only when every input is proven. */
export function semanticIdentityDigest(
  config: Node,
  kind: "dense" | "sparse",
  adapter: Adapter,
  modalities: readonly ProjectIndexMediaModality[] | undefined,
  view: SemanticAnalyzerView,
): string | undefined {
  return adapter === "core"
    ? coreDigest(config, kind, modalities, view)
    : providerDigest(config, adapter, modalities, view);
}

function coreDigest(
  config: Node,
  kind: "dense" | "sparse",
  modalities: readonly ProjectIndexMediaModality[] | undefined,
  view: SemanticAnalyzerView,
): string | undefined {
  const name = stringProperty(config, "name", view);
  const dimensions = numberProperty(config, "dimensions", view);
  const maxInputTokens = numberProperty(config, "maxInputTokens", view);
  if (
    !name ||
    maxInputTokens === undefined ||
    (kind === "dense" && dimensions === undefined) ||
    !modalities ||
    hasAnyProperty(
      config,
      ["preprocess", "truncate", "tasks", "version", "normalization"],
      view,
    )
  ) {
    return undefined;
  }
  return resolvedEmbeddingIdentity({
    kind,
    inputs: {},
    complete: true,
    fingerprint: {
      name,
      dimensions,
      maxInputTokens,
      preprocessors: [],
      truncate: { strategy: "fail" },
      modalities,
      normalization: kind === "dense" ? "unknown" : undefined,
    },
  }).digest;
}

function providerDigest(
  config: Node,
  adapter: Exclude<Adapter, "core">,
  modalities: readonly ProjectIndexMediaModality[] | undefined,
  view: SemanticAnalyzerView,
): string | undefined {
  if (
    !modalities ||
    hasAnyProperty(
      config,
      ["preprocess", "truncate", "tasks", "normalization"],
      view,
    )
  ) {
    return undefined;
  }
  const model = stringProperty(config, "model", view);
  const authoredVersion = optionalString(config, "version", view);
  if (!model || authoredVersion === null) return undefined;

  const resolved =
    adapter === "google"
      ? googleInputs(config, model, authoredVersion, modalities, view)
      : adapter === "openai"
        ? openAIInputs(config, model, authoredVersion, modalities, view)
        : aiSdkInputs(config, model, authoredVersion, modalities, view);
  if (!resolved) return undefined;
  const inputs: EmbeddingIdentityInputs = {
    name: resolved.name,
    version: resolved.version,
    dimensions: resolved.dimensions,
    maxInputTokens: resolved.maxInputTokens,
    truncate: { strategy: "fail" },
    modalities,
    normalization: "unknown",
    preprocessorCount: 0,
  };
  return resolvedEmbeddingIdentity({
    kind: "dense",
    inputs,
    complete: true,
    fingerprint: {
      name: resolved.name,
      version: resolved.version,
      dimensions: resolved.dimensions,
      maxInputTokens: resolved.maxInputTokens,
      preprocessors: [],
      truncate: { strategy: "fail" },
      modalities,
      normalization: "unknown",
    },
  }).digest;
}

interface ProviderInputs {
  readonly name: string;
  readonly version: string;
  readonly dimensions: number;
  readonly maxInputTokens: number;
}

function googleInputs(
  config: Node,
  model: string,
  authoredVersion: string | undefined,
  _modalities: readonly ProjectIndexMediaModality[],
  view: SemanticAnalyzerView,
): ProviderInputs | undefined {
  if (hasAnyProperty(config, ["title", "mimeType", "autoTruncate"], view))
    return undefined;
  const defaults =
    googleEmbeddingDefaults[model as keyof typeof googleEmbeddingDefaults];
  const dimensions =
    numberProperty(config, "dimensions", view) ??
    (defaults && "dimensions" in defaults ? defaults.dimensions : undefined);
  const maxInputTokens =
    numberProperty(config, "maxInputTokens", view) ??
    (defaults && "maxInputTokens" in defaults
      ? defaults.maxInputTokens
      : undefined);
  const name = stringProperty(config, "name", view) ?? model;
  if (dimensions === undefined || maxInputTokens === undefined)
    return undefined;
  const version = [
    `google:model=${JSON.stringify(model)}`,
    "tasks.query=default",
    "tasks.document=default",
    "title=default",
    "mimeType=default",
    "autoTruncate=default",
    ...(authoredVersion ? [`version=${JSON.stringify(authoredVersion)}`] : []),
  ].join(";");
  return { name, version, dimensions, maxInputTokens };
}

function openAIInputs(
  config: Node,
  model: string,
  authoredVersion: string | undefined,
  _modalities: readonly ProjectIndexMediaModality[],
  view: SemanticAnalyzerView,
): ProviderInputs | undefined {
  const name = stringProperty(config, "name", view);
  const dimensions =
    numberProperty(config, "dimensions", view) ??
    openAIEmbeddingDimensions[model as keyof typeof openAIEmbeddingDimensions];
  const maxInputTokens = numberProperty(config, "maxInputTokens", view) ?? 8192;
  if (!name || dimensions === undefined) return undefined;
  const version = `openai:model=${JSON.stringify(model)}${authoredVersion ? `;version=${JSON.stringify(authoredVersion)}` : ""}`;
  return { name, version, dimensions, maxInputTokens };
}

function aiSdkInputs(
  config: Node,
  model: string,
  authoredVersion: string | undefined,
  _modalities: readonly ProjectIndexMediaModality[],
  view: SemanticAnalyzerView,
): ProviderInputs | undefined {
  const name = stringProperty(config, "name", view);
  const dimensions = numberProperty(config, "dimensions", view);
  const maxInputTokens = numberProperty(config, "maxInputTokens", view);
  if (!name || dimensions === undefined || maxInputTokens === undefined)
    return undefined;
  const version = `ai-sdk:model=${JSON.stringify(model)}${authoredVersion ? `;version=${JSON.stringify(authoredVersion)}` : ""}`;
  return { name, version, dimensions, maxInputTokens };
}

function numberProperty(
  object: Node,
  property: string,
  view: SemanticAnalyzerView,
): number | undefined {
  const expression = propertyInitializer(object, property, view);
  const value = expression ? semanticLiteral(expression, view) : undefined;
  return typeof value === "number" ? value : undefined;
}

function optionalString(
  object: Node,
  property: string,
  view: SemanticAnalyzerView,
): string | undefined | null {
  const expression = propertyInitializer(object, property, view);
  if (!expression) return undefined;
  return stringProperty(object, property, view) ?? null;
}

function hasAnyProperty(
  object: Node,
  properties: readonly string[],
  view: SemanticAnalyzerView,
): boolean {
  return properties.some((property) =>
    propertyInitializer(object, property, view),
  );
}
