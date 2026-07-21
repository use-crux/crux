/**
 * Pure Catalog projections for authored multimodal architecture.
 *
 * Catalog is static/authored Project Index truth only. These helpers never
 * merge runtime run facts, never retain media locators, and keep
 * `unknown` support visibly distinct from unsupported absence.
 *
 * @module
 */

/** Closed modality vocabulary shared by media and embedding Catalog views. */
export const MEDIA_MODALITIES = [
  "text",
  "image",
  "audio",
  "video",
  "document",
] as const;

/** A modality the Project Index Catalog can present and filter. */
export type MediaModality = (typeof MEDIA_MODALITIES)[number];

export type MediaExecutionSupport = "native" | "composed" | "unknown";

export type MediaOperationName =
  | "generate"
  | "stream"
  | "generateImage"
  | "transcribe"
  | "generateSpeech"
  | "describe";

/** Allowlisted authored options retained for Catalog display. */
export type MediaAuthoredOptions = Readonly<{
  n?: number;
  size?: string;
  aspectRatio?: string;
  seed?: number;
  timestamps?: string;
  diarization?: boolean;
  task?: "transcribe" | "translate";
  voice?: string;
}>;

/** Purpose-built Catalog card for `media.operation` definitions. */
export type MediaOperationCatalogView = Readonly<{
  kind: "media.operation";
  id: string;
  name: string;
  operation: MediaOperationName | "unknown";
  inputModalities: readonly MediaModality[];
  outputModalities: readonly MediaModality[];
  adapter?: string;
  model?: string;
  execution: MediaExecutionSupport;
  authoredOptions: MediaAuthoredOptions;
  sourceFile?: string;
  sourceLine?: number;
  fidelity?: string;
  warningCount: number;
  relations: readonly MediaCatalogRelation[];
}>;

/** Purpose-built Catalog card for `ingest.source` definitions. */
export type IngestSourceCatalogView = Readonly<{
  kind: "ingest.source";
  id: string;
  name: string;
  sourceKind: "file" | "url" | "asset" | "custom" | "unknown";
  mediaKinds: readonly MediaModality[];
  namespace?: string;
  attribution: readonly ("page" | "time")[];
  sourceFile?: string;
  sourceLine?: number;
  fidelity?: string;
  warningCount: number;
  relations: readonly MediaCatalogRelation[];
}>;

export type MediaCatalogRelation = Readonly<{
  id: string;
  type: string;
  direction: "from" | "to";
  otherId: string;
  otherName?: string;
  otherKind?: string;
}>;

export type MediaCatalogFilter =
  | "media"
  | "embeddings"
  | "images"
  | "audio"
  | "video"
  | "documents"
  | "generated-media"
  | "transcription"
  | "speech"
  | "ingest-sources"
  | "native"
  | "composed"
  | "unknown-support"
  | "has-warnings";

const MEDIA_OPS = new Set<string>([
  "generate",
  "stream",
  "generateImage",
  "transcribe",
  "generateSpeech",
  "describe",
]);

const MODALITIES = new Set<string>(MEDIA_MODALITIES);

/** Project a Project Index definition into a media-operation Catalog card. */
export function projectMediaOperationCatalog(
  input: Readonly<{
    id: string;
    name: string;
    kind: string;
    fidelity?: string;
    file?: string;
    line?: number;
    facts?: unknown;
    warningCount?: number;
    relations?: readonly MediaCatalogRelation[];
  }>,
): MediaOperationCatalogView | undefined {
  if (input.kind !== "media.operation") return undefined;
  const facts = asRecord(input.facts);
  const operation = stringValue(facts?.operation);
  const execution = executionValue(facts?.execution);
  return Object.freeze({
    kind: "media.operation",
    id: input.id,
    name: input.name,
    operation:
      operation && MEDIA_OPS.has(operation)
        ? (operation as MediaOperationName)
        : "unknown",
    inputModalities: mediaModalityList(facts?.inputModalities),
    outputModalities: mediaModalityList(facts?.outputModalities),
    ...(stringValue(facts?.adapter)
      ? { adapter: stringValue(facts?.adapter) }
      : {}),
    ...(stringValue(facts?.model) ? { model: stringValue(facts?.model) } : {}),
    execution,
    authoredOptions: projectAuthoredOptions(facts?.authoredOptions),
    ...(input.file ? { sourceFile: input.file } : {}),
    ...(typeof input.line === "number" ? { sourceLine: input.line } : {}),
    ...(input.fidelity ? { fidelity: input.fidelity } : {}),
    warningCount: Math.max(0, input.warningCount ?? 0),
    relations: Object.freeze([...(input.relations ?? [])]),
  });
}

/** Project a Project Index definition into an ingest-source Catalog card. */
export function projectIngestSourceCatalog(
  input: Readonly<{
    id: string;
    name: string;
    kind: string;
    fidelity?: string;
    file?: string;
    line?: number;
    facts?: unknown;
    warningCount?: number;
    relations?: readonly MediaCatalogRelation[];
  }>,
): IngestSourceCatalogView | undefined {
  if (input.kind !== "ingest.source") return undefined;
  const facts = asRecord(input.facts);
  const sourceKind = stringValue(facts?.sourceKind);
  const attribution = arrayOf(facts?.attribution).filter(
    (item): item is "page" | "time" => item === "page" || item === "time",
  );
  return Object.freeze({
    kind: "ingest.source",
    id: input.id,
    name: input.name,
    sourceKind:
      sourceKind === "file" ||
      sourceKind === "url" ||
      sourceKind === "asset" ||
      sourceKind === "custom"
        ? sourceKind
        : "unknown",
    mediaKinds: mediaModalityList(facts?.mediaKinds),
    ...(stringValue(facts?.namespace)
      ? { namespace: stringValue(facts?.namespace) }
      : {}),
    attribution: Object.freeze(attribution),
    ...(input.file ? { sourceFile: input.file } : {}),
    ...(typeof input.line === "number" ? { sourceLine: input.line } : {}),
    ...(input.fidelity ? { fidelity: input.fidelity } : {}),
    warningCount: Math.max(0, input.warningCount ?? 0),
    relations: Object.freeze([...(input.relations ?? [])]),
  });
}

export {
  matchesMediaCatalogFilter,
  mediaCatalogBadges,
} from "./media-catalog-filters";

function projectAuthoredOptions(value: unknown): MediaAuthoredOptions {
  const record = asRecord(value);
  if (!record) return Object.freeze({});
  return Object.freeze({
    ...(numberValue(record.n) !== undefined
      ? { n: numberValue(record.n) }
      : {}),
    ...(stringValue(record.size) ? { size: stringValue(record.size) } : {}),
    ...(stringValue(record.aspectRatio)
      ? { aspectRatio: stringValue(record.aspectRatio) }
      : {}),
    ...(numberValue(record.seed) !== undefined
      ? { seed: numberValue(record.seed) }
      : {}),
    ...(stringValue(record.timestamps)
      ? { timestamps: stringValue(record.timestamps) }
      : {}),
    ...(typeof record.diarization === "boolean"
      ? { diarization: record.diarization }
      : {}),
    ...(record.task === "transcribe" || record.task === "translate"
      ? { task: record.task }
      : {}),
    ...(stringValue(record.voice) ? { voice: stringValue(record.voice) } : {}),
  });
}

/** Project unknown input through the closed Catalog modality allowlist. */
export function mediaModalityList(value: unknown): readonly MediaModality[] {
  return Object.freeze(
    arrayOf(value).filter((item): item is MediaModality =>
      MODALITIES.has(item),
    ),
  );
}

function executionValue(value: unknown): MediaExecutionSupport {
  return value === "native" || value === "composed" || value === "unknown"
    ? value
    : "unknown";
}

function arrayOf(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
