/**
 * Immutable JSON Schema traversal for tool-description exposure guards.
 *
 * @internal
 * @module
 */

import type {
  ToolDefinitionOrigin,
  ToolDescriptionOrigin,
} from "../../../safety";
import type { ToolExposureGuards } from "./types";

interface GuardSchemaDescriptionsOptions {
  readonly schema: Readonly<Record<string, unknown>>;
  readonly origin: ToolDefinitionOrigin;
  readonly guard: ToolExposureGuards["descriptions"];
}

/** Guard schema `title` and `description` string leaves in depth-first order. */
export async function guardSchemaDescriptions(
  options: GuardSchemaDescriptionsOptions,
): Promise<Readonly<Record<string, unknown>>> {
  const guarded = await visit(options.schema, [], options);
  return isRecord(guarded) ? guarded : {};
}

/** Clone and recursively freeze a canonical provider-visible JSON value. */
export function cloneAndFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((entry) => cloneAndFreeze(entry))) as T;
  }
  if (!isRecord(value)) return value;
  const clone = Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, cloneAndFreeze(entry)]),
  );
  return Object.freeze(clone) as T;
}

async function visit(
  value: unknown,
  path: readonly (string | number)[],
  options: GuardSchemaDescriptionsOptions,
): Promise<unknown> {
  if (Array.isArray(value)) {
    const entries: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      entries.push(await visit(value[index], [...path, index], options));
    }
    return entries;
  }
  if (!isRecord(value)) return value;

  const entries: Array<readonly [string, unknown]> = [];
  for (const [key, entry] of Object.entries(value)) {
    if (
      (key === "title" || key === "description") &&
      typeof entry === "string"
    ) {
      const result = await options.guard(entry, {
        ...options.origin,
        descriptionKind: "schema",
        schemaDepth: path.length,
      });
      entries.push([
        key,
        result.action === "rewrite" ? result.value : entry,
      ]);
      continue;
    }
    entries.push([key, await visit(entry, [...path, key], options)]);
  }
  return Object.fromEntries(entries);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
