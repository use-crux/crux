import { embeddingSpaceDigest } from "@use-crux/core/embedding";
import type {
  EmbeddingIdentityInputs,
  EmbeddingSpaceFacts,
  ProjectIndexMediaModality,
} from "@use-crux/core/project-index";
import type { ConfigReader } from "../extensions";

export interface ProvenEmbeddingIdentity {
  readonly inputs: EmbeddingIdentityInputs;
  readonly fingerprint?: string;
  readonly digest?: string;
  readonly space?: EmbeddingSpaceFacts;
}

/** Project safe identity inputs and an exact digest when every input is known. */
export function coreEmbeddingIdentity(
  config: ConfigReader,
  embeddingKind: "dense" | "sparse",
): ProvenEmbeddingIdentity {
  const name = config.string("name");
  const maxInputTokens = config.number("maxInputTokens");
  const dimensions =
    embeddingKind === "dense" ? config.number("dimensions") : undefined;
  const modalityResult = knownModalities(config);
  const modalities = modalityResult.value;
  const normalizationResult =
    embeddingKind === "dense"
      ? knownNormalization(config)
      : { proven: true, value: undefined };
  const normalization = normalizationResult.value;
  const truncate = knownTruncate(config);
  const version = optionalString(config, "version");
  const tasks = knownTasks(config);
  const preprocessorCount = knownPreprocessorCount(config);
  const inputs: EmbeddingIdentityInputs = {
    ...(name !== undefined ? { name } : {}),
    ...(version.value !== undefined ? { version: version.value } : {}),
    ...(dimensions !== undefined ? { dimensions } : {}),
    ...(maxInputTokens !== undefined ? { maxInputTokens } : {}),
    ...(truncate.value ? { truncate: truncate.value } : {}),
    ...(modalities ? { modalities } : {}),
    ...(normalization ? { normalization } : {}),
    ...(tasks.value !== undefined ? { tasks: tasks.value } : {}),
    ...(preprocessorCount !== undefined ? { preprocessorCount } : {}),
  };

  const exact =
    name !== undefined &&
    maxInputTokens !== undefined &&
    (embeddingKind === "sparse" || dimensions !== undefined) &&
    modalityResult.proven &&
    modalities !== undefined &&
    normalizationResult.proven &&
    truncate.proven &&
    version.proven &&
    tasks.proven &&
    preprocessorCount === 0;
  if (!exact) {
    const space = embeddingSpaceFacts(embeddingKind, name, dimensions);
    return { inputs, ...(space ? { space } : {}) };
  }

  return resolvedEmbeddingIdentity({
    kind: embeddingKind,
    inputs,
    complete: true,
    fingerprint: {
      name,
      dimensions,
      maxInputTokens,
      preprocessors: [],
      truncate: truncate.fingerprintValue,
      version: version.value,
      modalities,
      normalization,
      tasks: tasks.value,
    },
  });
}

/** Build the exact runtime fingerprint from provider-resolved static inputs. */
export function resolvedEmbeddingIdentity(input: {
  readonly kind: "dense" | "sparse";
  readonly inputs: EmbeddingIdentityInputs;
  readonly complete: boolean;
  readonly fingerprint: {
    readonly name?: string;
    readonly dimensions?: number;
    readonly maxInputTokens?: number;
    readonly preprocessors: readonly string[];
    readonly truncate?:
      | EmbeddingIdentityInputs["truncate"]
      | Readonly<Record<string, unknown>>;
    readonly version?: string;
    readonly modalities?: readonly ProjectIndexMediaModality[];
    readonly normalization?: EmbeddingIdentityInputs["normalization"];
    readonly tasks?: EmbeddingIdentityInputs["tasks"];
  };
}): ProvenEmbeddingIdentity {
  const { name, dimensions } = input.fingerprint;
  if (!input.complete) {
    const space = embeddingSpaceFacts(input.kind, name, dimensions);
    return { inputs: input.inputs, ...(space ? { space } : {}) };
  }
  const fingerprint = stableStringify({
    kind: input.kind,
    name: input.fingerprint.name,
    dimensions:
      input.kind === "dense" ? input.fingerprint.dimensions : undefined,
    maxInputTokens: input.fingerprint.maxInputTokens,
    preprocessors: input.fingerprint.preprocessors,
    truncate: input.fingerprint.truncate,
    version: input.fingerprint.version,
    modalities: input.fingerprint.modalities
      ? [...input.fingerprint.modalities].sort()
      : undefined,
    normalization: input.fingerprint.normalization,
    tasks: input.fingerprint.tasks,
  });
  const digest = embeddingSpaceDigest(fingerprint);
  const space = embeddingSpaceFacts(input.kind, name, dimensions, digest);
  return {
    inputs: input.inputs,
    fingerprint,
    digest,
    ...(space ? { space } : {}),
  };
}

/** Keep safe dense-space presentation facts even when its digest is unknown. */
function embeddingSpaceFacts(
  kind: "dense" | "sparse",
  name: string | undefined,
  dimensions: number | undefined,
  digest?: string,
): EmbeddingSpaceFacts | undefined {
  return kind === "dense" && name !== undefined && dimensions !== undefined
    ? { name, dimensions, ...(digest ? { digest } : {}) }
    : undefined;
}

function knownModalities(config: ConfigReader): {
  readonly proven: boolean;
  readonly value?: readonly ProjectIndexMediaModality[];
} {
  if (!config.has("modalities")) return { proven: true, value: ["text"] };
  const value = config.json("modalities");
  const allowed = new Set<ProjectIndexMediaModality>([
    "text",
    "image",
    "audio",
    "video",
    "document",
  ]);
  return Array.isArray(value) &&
    value.every(
      (item): item is ProjectIndexMediaModality =>
        typeof item === "string" &&
        allowed.has(item as ProjectIndexMediaModality),
    )
    ? { proven: true, value }
    : { proven: false };
}

function knownNormalization(config: ConfigReader): {
  readonly proven: boolean;
  readonly value?: EmbeddingIdentityInputs["normalization"];
} {
  if (!config.has("normalization")) return { proven: true, value: "unknown" };
  const value = config.string("normalization");
  return value === "unit" || value === "none" || value === "unknown"
    ? { proven: true, value }
    : { proven: false };
}

function knownTruncate(config: ConfigReader): {
  readonly proven: boolean;
  readonly value?: NonNullable<EmbeddingIdentityInputs["truncate"]>;
  readonly fingerprintValue?: Readonly<Record<string, unknown>>;
} {
  if (!config.has("truncate")) {
    const value = { strategy: "fail" as const };
    return { proven: true, value, fingerprintValue: value };
  }
  const value = config.object("truncate");
  if (!value) return { proven: false };
  const strategy = value.string("strategy");
  if (strategy === undefined && !value.has("strategy")) {
    return {
      proven: true,
      value: { strategy: "fail" },
      fingerprintValue: {},
    };
  }
  if (strategy === "fail") {
    const normalized = { strategy: "fail" as const };
    return { proven: true, value: normalized, fingerprintValue: normalized };
  }
  const maxChars = value.number("maxChars");
  return strategy === "chars" && maxChars !== undefined
    ? {
        proven: true,
        value: { strategy, maxChars },
        fingerprintValue: { strategy, maxChars },
      }
    : { proven: false };
}

function optionalString(
  config: ConfigReader,
  property: string,
): { readonly proven: boolean; readonly value?: string } {
  if (!config.has(property)) return { proven: true };
  const value = config.string(property);
  return value === undefined ? { proven: false } : { proven: true, value };
}

function knownTasks(config: ConfigReader): {
  readonly proven: boolean;
  readonly value?: NonNullable<EmbeddingIdentityInputs["tasks"]>;
} {
  if (!config.has("tasks")) return { proven: true };
  const tasks = config.object("tasks");
  if (!tasks) return { proven: false };
  const raw = config.json("tasks");
  const closed =
    raw !== null &&
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    Object.keys(raw).every((key) => key === "query" || key === "document");
  const query = optionalString(tasks, "query");
  const document = optionalString(tasks, "document");
  if (!query.proven || !document.proven) return { proven: false };
  return {
    proven: closed,
    value: {
      ...(query.value !== undefined ? { query: query.value } : {}),
      ...(document.value !== undefined ? { document: document.value } : {}),
    },
  };
}

function knownPreprocessorCount(config: ConfigReader): number | undefined {
  if (!config.has("preprocess")) return 0;
  const value = config.json("preprocess");
  return Array.isArray(value)
    ? value.length
    : value === undefined
      ? undefined
      : 1;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}
