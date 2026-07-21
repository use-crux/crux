import type {
  EmbeddingIdentityInputs,
  ProjectIndexMediaModality,
} from "@use-crux/core/project-index";
import type { ConfigReader } from "../extensions";

export interface Known<T> {
  readonly proven: boolean;
  readonly value?: T;
}

export function requiredString(
  config: ConfigReader,
  property: string,
): Known<string> {
  const value = config.string(property);
  return value === undefined ? { proven: false } : { proven: true, value };
}

export function defaultedString(
  config: ConfigReader,
  property: string,
  fallback: string | undefined,
): Known<string> {
  return config.has(property)
    ? requiredString(config, property)
    : { proven: fallback !== undefined, value: fallback };
}

export function requiredNumber(
  config: ConfigReader,
  property: string,
): Known<number> {
  const value = config.number(property);
  return value === undefined ? { proven: false } : { proven: true, value };
}

export function defaultedNumber(
  config: ConfigReader,
  property: string,
  fallback: number | undefined,
): Known<number> {
  return config.has(property)
    ? requiredNumber(config, property)
    : { proven: fallback !== undefined, value: fallback };
}

export function optionalString(
  config: ConfigReader,
  property: string,
): Known<string> {
  if (!config.has(property)) return { proven: true };
  return requiredString(config, property);
}

export function optionalBoolean(
  config: ConfigReader,
  property: string,
): Known<boolean> {
  if (!config.has(property)) return { proven: true };
  const value = config.boolean(property);
  return value === undefined ? { proven: false } : { proven: true, value };
}

export function knownModalities(
  config: ConfigReader,
  fallback: readonly ProjectIndexMediaModality[] | undefined,
): Known<readonly ProjectIndexMediaModality[]> {
  if (!config.has("modalities")) {
    return { proven: fallback !== undefined, value: fallback };
  }
  const value = config.json("modalities");
  const allowed = new Set(["text", "image", "audio", "video", "document"]);
  return Array.isArray(value) &&
    value.every((item) => typeof item === "string" && allowed.has(item))
    ? { proven: true, value: value as ProjectIndexMediaModality[] }
    : { proven: false };
}

export function knownTasks(
  config: ConfigReader,
): Known<EmbeddingIdentityInputs["tasks"]> {
  if (!config.has("tasks")) return { proven: true };
  const value = config.object("tasks");
  if (!value) return { proven: false };
  const raw = config.json("tasks");
  const closed =
    raw !== null &&
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    Object.keys(raw).every((key) => key === "query" || key === "document");
  const query = optionalString(value, "query");
  const document = optionalString(value, "document");
  return query.proven && document.proven
    ? {
        proven: closed,
        value: {
          ...(query.value !== undefined ? { query: query.value } : {}),
          ...(document.value !== undefined ? { document: document.value } : {}),
        },
      }
    : { proven: false };
}
