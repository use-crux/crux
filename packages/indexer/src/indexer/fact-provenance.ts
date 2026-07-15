import type { ProjectModelProvenance } from "@use-crux/core/project-index";
import { compareCodepoint } from "./sort";

const utf8Encoder = new TextEncoder();

/** Exact extractor declaration that contributed to one durable fact. */
export interface ProjectIndexFactExtractorProvenance {
  /** Exact extractor declaration name. */
  readonly name: string;
  /** Resolved installed extension identity. Omitted for first-party extractors. */
  readonly extension?: ProjectIndexFactProducerIdentity;
}

/** Name and exact resolved version of a durable fact contributor. */
export interface ProjectIndexFactProducerIdentity {
  readonly name: string;
  readonly version: string;
}

/** Project Model provenance extended only at the Indexer-owned fact boundary. */
export type ProjectIndexFactProvenance = ProjectModelProvenance & {
  /** Every extractor that actually contributed to this fact. */
  readonly extractors?: readonly ProjectIndexFactExtractorProvenance[];
};

/** Canonical extractor contributors keyed by stable definition id. */
export type ProjectIndexDefinitionExtractors = Readonly<
  Record<string, readonly ProjectIndexFactExtractorProvenance[]>
>;

/** Canonical extractor contributors keyed by an internal stable fact identity. */
export type ProjectIndexFactExtractors = Readonly<
  Record<string, readonly ProjectIndexFactExtractorProvenance[]>
>;

/** Deduplicate, validate, and sort fact contributors for durable persistence. */
export function canonicalFactExtractors(
  extractors: readonly ProjectIndexFactExtractorProvenance[],
): readonly ProjectIndexFactExtractorProvenance[] {
  const unique = new Map<string, ProjectIndexFactExtractorProvenance>();
  for (const extractor of extractors) {
    assertIdentityPart(extractor.name, "extractor name");
    if (extractor.extension) {
      assertIdentityPart(extractor.extension.name, "extension name");
      assertIdentityPart(extractor.extension.version, "extension version");
    }
    const key = [
      extractor.extension?.name ?? "",
      extractor.extension?.version ?? "",
      extractor.name,
    ].join("\0");
    unique.set(key, extractor);
  }
  return [...unique.values()].sort(compareFactExtractors);
}

/** Canonicalize every non-empty definition contributor list. */
export function canonicalDefinitionExtractors(
  input: ProjectIndexDefinitionExtractors | undefined,
): ProjectIndexDefinitionExtractors | undefined {
  if (!input) return undefined;
  const result: Record<string, readonly ProjectIndexFactExtractorProvenance[]> =
    {};
  for (const definitionId of Object.keys(input).sort(compareCodepoint)) {
    assertIdentityPart(definitionId, "definition id");
    const extractors = canonicalFactExtractors(input[definitionId] ?? []);
    if (extractors.length > 0) result[definitionId] = extractors;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

/** Canonicalize every non-empty fact contributor list. */
export function canonicalFactExtractorMap(
  input: ProjectIndexFactExtractors | undefined,
): ProjectIndexFactExtractors | undefined {
  if (!input) return undefined;
  const result: Record<string, readonly ProjectIndexFactExtractorProvenance[]> =
    {};
  for (const factId of Object.keys(input).sort(compareCodepoint)) {
    assertIdentityPart(factId, "fact id");
    const extractors = canonicalFactExtractors(input[factId] ?? []);
    if (extractors.length > 0) result[factId] = extractors;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

/** Render one canonical contributor label for Catalog explanation. */
export function factExtractorLabel(
  extractor: ProjectIndexFactExtractorProvenance,
): string {
  return extractor.extension
    ? `${extractor.extension.name}@${extractor.extension.version}/${extractor.name}`
    : extractor.name;
}

function compareFactExtractors(
  left: ProjectIndexFactExtractorProvenance,
  right: ProjectIndexFactExtractorProvenance,
): number {
  return (
    compareUtf8(left.extension?.name ?? "", right.extension?.name ?? "") ||
    compareUtf8(
      left.extension?.version ?? "",
      right.extension?.version ?? "",
    ) ||
    compareUtf8(left.name, right.name)
  );
}

function assertIdentityPart(value: string, label: string): void {
  if (
    value.length === 0 ||
    hasControlCharacter(value) ||
    !hasWellFormedUnicode(value)
  ) {
    throw new Error(`Invalid Project Index fact ${label}`);
  }
}

function compareUtf8(left: string, right: string): number {
  const leftBytes = utf8Encoder.encode(left);
  const rightBytes = utf8Encoder.encode(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    const compared = (leftBytes[index] ?? 0) - (rightBytes[index] ?? 0);
    if (compared !== 0) return compared;
  }
  return leftBytes.length - rightBytes.length;
}

function hasWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}
