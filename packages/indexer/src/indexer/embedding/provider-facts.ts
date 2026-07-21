import type {
  EmbeddingFacts,
  EmbeddingIdentityInputs,
  ProjectIndexMediaModality,
} from "@use-crux/core/project-index";
import type { ConfigReader } from "../extensions";
import {
  resolvedEmbeddingIdentity,
  type ProvenEmbeddingIdentity,
} from "./fingerprint";
import { googleEmbeddingDefaults, openAIEmbeddingDimensions } from "./manifest";
import {
  defaultedNumber,
  defaultedString,
  knownModalities,
  knownTasks,
  optionalBoolean,
  optionalString,
  requiredNumber,
  requiredString,
  type Known,
} from "./provider-values";

/** Project a provider adapter's literal model and exact runtime identity. */
export function providerEmbeddingFacts(
  config: ConfigReader,
  adapter: Exclude<NonNullable<EmbeddingFacts["adapter"]>, "core">,
): Pick<
  EmbeddingFacts,
  "model" | "identityInputs" | "identityDigest" | "space"
> {
  const resolved =
    adapter === "google"
      ? googleIdentity(config)
      : adapter === "openai"
        ? openAIIdentity(config)
        : aiSdkIdentity(config);
  return {
    ...(resolved.model ? { model: resolved.model } : {}),
    ...(Object.keys(resolved.identity.inputs).length
      ? { identityInputs: resolved.identity.inputs }
      : {}),
    ...(resolved.identity.digest
      ? { identityDigest: resolved.identity.digest }
      : {}),
    ...(resolved.identity.space ? { space: resolved.identity.space } : {}),
  };
}

interface ProviderIdentity {
  readonly model?: string;
  readonly identity: ProvenEmbeddingIdentity;
}

function googleIdentity(config: ConfigReader): ProviderIdentity {
  const model = config.string("model");
  const defaults = model
    ? googleEmbeddingDefaults[model as keyof typeof googleEmbeddingDefaults]
    : undefined;
  const name = defaultedString(config, "name", model);
  const dimensions = defaultedNumber(
    config,
    "dimensions",
    defaults && "dimensions" in defaults ? defaults.dimensions : undefined,
  );
  const maxInputTokens = defaultedNumber(
    config,
    "maxInputTokens",
    defaults && "maxInputTokens" in defaults
      ? defaults.maxInputTokens
      : undefined,
  );
  const modalities = knownModalities(
    config,
    defaults?.modalities ?? (model ? ["text"] : undefined),
  );
  const tasks = knownTasks(config);
  const authoredVersion = optionalString(config, "version");
  const title = optionalString(config, "title");
  const mimeType = optionalString(config, "mimeType");
  const autoTruncate = optionalBoolean(config, "autoTruncate");
  const version =
    model &&
    tasks.proven &&
    title.proven &&
    mimeType.proven &&
    autoTruncate.proven &&
    authoredVersion.proven
      ? [
          `google:model=${JSON.stringify(model)}`,
          `tasks.query=${identityValue(tasks.value?.query)}`,
          `tasks.document=${identityValue(tasks.value?.document)}`,
          `title=${identityValue(title.value)}`,
          `mimeType=${identityValue(mimeType.value)}`,
          `autoTruncate=${identityValue(autoTruncate.value)}`,
          ...(authoredVersion.value === undefined
            ? []
            : [`version=${JSON.stringify(authoredVersion.value)}`]),
        ].join(";")
      : undefined;
  return providerIdentity({
    model,
    name,
    dimensions,
    maxInputTokens,
    modalities,
    tasks,
    version: { proven: version !== undefined, value: version },
  });
}

function openAIIdentity(config: ConfigReader): ProviderIdentity {
  const model = config.string("model");
  const inferredDimensions = model
    ? openAIEmbeddingDimensions[model as keyof typeof openAIEmbeddingDimensions]
    : undefined;
  const authoredVersion = optionalString(config, "version");
  const version =
    model && authoredVersion.proven
      ? [
          `openai:model=${JSON.stringify(model)}`,
          ...(authoredVersion.value === undefined
            ? []
            : [`version=${JSON.stringify(authoredVersion.value)}`]),
        ].join(";")
      : undefined;
  return providerIdentity({
    model,
    name: requiredString(config, "name"),
    dimensions: defaultedNumber(config, "dimensions", inferredDimensions),
    maxInputTokens: defaultedNumber(config, "maxInputTokens", 8192),
    modalities: { proven: true, value: ["text"] },
    tasks: { proven: true },
    version: { proven: version !== undefined, value: version },
  });
}

function aiSdkIdentity(config: ConfigReader): ProviderIdentity {
  const model = aiSdkModel(config);
  const authoredVersion = optionalString(config, "version");
  const version =
    model.identity && authoredVersion.proven
      ? [
          `ai-sdk:${model.identity}`,
          ...(authoredVersion.value === undefined
            ? []
            : [`version=${JSON.stringify(authoredVersion.value)}`]),
        ].join(";")
      : undefined;
  return providerIdentity({
    model: model.model,
    name: requiredString(config, "name"),
    dimensions: requiredNumber(config, "dimensions"),
    maxInputTokens: requiredNumber(config, "maxInputTokens"),
    modalities: { proven: true, value: ["text"] },
    tasks: { proven: true },
    version: { proven: version !== undefined, value: version },
  });
}

function providerIdentity(input: {
  readonly model?: string;
  readonly name: Known<string>;
  readonly dimensions: Known<number>;
  readonly maxInputTokens: Known<number>;
  readonly modalities: Known<readonly ProjectIndexMediaModality[]>;
  readonly tasks: Known<EmbeddingIdentityInputs["tasks"]>;
  readonly version: Known<string>;
}): ProviderIdentity {
  const inputs: EmbeddingIdentityInputs = {
    ...(input.name.value !== undefined ? { name: input.name.value } : {}),
    ...(input.version.value !== undefined
      ? { version: input.version.value }
      : {}),
    ...(input.dimensions.value !== undefined
      ? { dimensions: input.dimensions.value }
      : {}),
    ...(input.maxInputTokens.value !== undefined
      ? { maxInputTokens: input.maxInputTokens.value }
      : {}),
    truncate: { strategy: "fail" },
    ...(input.modalities.value ? { modalities: input.modalities.value } : {}),
    normalization: "unknown",
    ...(input.tasks.value !== undefined ? { tasks: input.tasks.value } : {}),
    preprocessorCount: 0,
  };
  return {
    model: input.model,
    identity: resolvedEmbeddingIdentity({
      kind: "dense",
      inputs,
      complete:
        input.name.proven &&
        input.dimensions.proven &&
        input.maxInputTokens.proven &&
        input.modalities.proven &&
        input.tasks.proven &&
        input.version.proven,
      fingerprint: {
        name: input.name.value,
        dimensions: input.dimensions.value,
        maxInputTokens: input.maxInputTokens.value,
        preprocessors: [],
        truncate: { strategy: "fail" },
        version: input.version.value,
        modalities: input.modalities.value,
        normalization: "unknown",
        tasks: input.tasks.value,
      },
    }),
  };
}

function aiSdkModel(config: ConfigReader): {
  readonly identity?: string;
  readonly model?: string;
} {
  const literal = config.string("model");
  if (literal) {
    return { identity: `model=${JSON.stringify(literal)}`, model: literal };
  }
  const model = config.object("model");
  const provider = model?.string("provider");
  const modelId = model?.string("modelId");
  return provider && modelId
    ? {
        identity: `provider=${JSON.stringify(provider)};modelId=${JSON.stringify(modelId)}`,
        model: modelId,
      }
    : {};
}

function identityValue(value: string | boolean | undefined): string {
  return value === undefined ? "default" : JSON.stringify(value);
}
