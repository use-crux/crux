/**
 * Closed Catalog projections for statically discovered Effects.
 *
 * @module
 */

import type { ProjectSourceRef } from "@/types";

/** Static certainty retained for one authored Effect option. */
export type EffectCatalogPresence = boolean | "unknown";

/** Execute call site safe to present in the Effect Catalog. */
export interface EffectCatalogSource {
  readonly refId: string;
  readonly file: string;
  readonly line: number;
  readonly column?: number;
}

/** Purpose-built Catalog view for one statically discovered Effect. */
export interface EffectCatalogView {
  readonly kind: "effect";
  readonly id: string;
  readonly name: string;
  readonly effectId?: string;
  readonly version?: number;
  readonly recoverable: EffectCatalogPresence;
  readonly capture: EffectCatalogPresence;
  readonly resource: EffectCatalogPresence;
  readonly sources?: readonly EffectCatalogSource[];
}

/** Project one Effect definition without inventing unresolved authored facts. */
export function projectEffectCatalog(input: {
  readonly id: string;
  readonly kind: string;
  readonly name: string;
  readonly facts?: unknown;
  readonly sourceRefs?: readonly ProjectSourceRef[];
  readonly relPath: (file?: string) => string | undefined;
}): EffectCatalogView | undefined {
  const facts = asRecord(input.facts);
  if (input.kind !== "effect" || facts?.kind !== "effect") return undefined;

  const sources = projectSources(input.sourceRefs, input.relPath);
  const effectId = nonEmptyString(facts.effectId);
  const version = finiteNumber(facts.version);
  return Object.freeze({
    kind: "effect",
    id: input.id,
    name: input.name,
    ...(effectId ? { effectId } : {}),
    ...(version === undefined ? {} : { version }),
    recoverable: presence(facts.recoverable),
    capture: presence(facts.capture),
    resource: presence(facts.resource),
    ...(sources.length > 0 ? { sources } : {}),
  });
}

/** Return the compact identity/version/recovery label used by Catalog rows. */
export function effectCatalogRailLabel(view: EffectCatalogView): string {
  const version =
    view.version === undefined ? "version unknown" : `v${view.version}`;
  const recovery =
    view.recoverable === true
      ? "recoverable"
      : view.recoverable === false
        ? "irreversible"
        : "recovery unknown";
  return [...(view.effectId ? [] : ["dynamic id"]), version, recovery].join(
    " · ",
  );
}

function projectSources(
  refs: readonly ProjectSourceRef[] | undefined,
  relPath: (file?: string) => string | undefined,
): readonly EffectCatalogSource[] {
  return Object.freeze(
    (refs ?? [])
      .filter((ref) => ref.role === "execute")
      .map((ref) =>
        Object.freeze({
          refId: ref.id,
          file: relPath(ref.source.file) ?? ref.source.file,
          line: ref.source.line,
          ...(ref.source.column === undefined
            ? {}
            : { column: ref.source.column }),
        }),
      ),
  );
}

function presence(value: unknown): EffectCatalogPresence {
  return typeof value === "boolean" || value === "unknown" ? value : "unknown";
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
