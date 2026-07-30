/**
 * Build and publish the bounded catalogue of canonical inspectable prompts.
 *
 * Invalid individual targets fail closed. Capability-wide overflow omits only
 * exact preview, leaving unrelated Runtime Bridge capabilities available.
 *
 * @module
 */

import { toCanonicalJsonSchema } from "../../adapter/structured-output/canonical-schema";
import { promptDefinitionRef } from "../../observability/definition-ref";
import type { AnyPrompt } from "../../prompt/prompt-types";
import {
  activePromptCatalogue,
  publishPromptCatalogue,
  retirePromptCatalogue,
  type ActivePromptCatalogueEntry,
  type PromptCatalogueOwner,
} from "../../runtime/prompt-catalogue";
import {
  PROMPT_PREVIEW_MAX_CAPABILITY_BYTES,
  PROMPT_PREVIEW_MAX_SCHEMA_BYTES,
  PROMPT_PREVIEW_MAX_TARGETS,
  compactJson,
} from "./limits";
import {
  PromptPreviewCapabilitySchema,
  PromptPreviewTargetSchema,
  StrictJsonObjectSchema,
  type PromptPreviewCapability,
  type PromptPreviewTarget,
} from "./protocol";

/** Publish a successful public registry and return its stale-safe retirement. */
export function publishConfiguredPromptCatalogue(
  prompts: readonly AnyPrompt[],
): () => void {
  const projection = catalogueEntries(prompts);
  const owner = publishPromptCatalogue(projection.entries);
  const published = activePromptCatalogue();
  const capability = promptPreviewCapability(
    published.revision,
    published.entries,
  );
  if (
    projection.invalidTargetCount > 0 ||
    projection.collisionTargetCount > 0 ||
    (published.entries.length > 0 && !capability)
  ) {
    console.warn("CRUX_PROMPT_PREVIEW_CATALOGUE_OMITTED", {
      authoredTargetCount: prompts.length,
      invalidTargetCount: projection.invalidTargetCount,
      collisionTargetCount: projection.collisionTargetCount,
      retainedTargetCount: published.entries.length,
      capabilityOmitted: published.entries.length > 0 && !capability,
    });
  }
  return retirement(owner);
}

/** Derive the current capability from an immutable process publication. */
export function promptPreviewCapability(
  revision: number,
  entries: readonly ActivePromptCatalogueEntry[],
): PromptPreviewCapability | undefined {
  if (
    revision <= 0 ||
    entries.length === 0 ||
    entries.length > PROMPT_PREVIEW_MAX_TARGETS
  ) {
    return undefined;
  }
  const candidate = {
    command: "prompt.previewExact" as const,
    catalogueRevision: revision,
    targets: entries.map((entry) => entry.target),
  };
  if (compactJson(candidate).bytes > PROMPT_PREVIEW_MAX_CAPABILITY_BYTES) {
    return undefined;
  }
  return PromptPreviewCapabilitySchema.parse(candidate);
}

function catalogueEntries(prompts: readonly AnyPrompt[]): {
  readonly entries: readonly ActivePromptCatalogueEntry[];
  readonly invalidTargetCount: number;
  readonly collisionTargetCount: number;
} {
  const projected = prompts.map(projectPrompt).filter(
    (
      entry,
    ): entry is {
      readonly prompt: AnyPrompt;
      readonly target: PromptPreviewTarget;
    } => entry !== undefined,
  );
  const counts = new Map<string, number>();
  for (const entry of projected) {
    counts.set(
      entry.target.definitionId,
      (counts.get(entry.target.definitionId) ?? 0) + 1,
    );
  }
  const collisionTargetCount = projected.filter(
    (entry) => counts.get(entry.target.definitionId)! > 1,
  ).length;
  const entries = Object.freeze(
    projected
      .filter((entry) => counts.get(entry.target.definitionId) === 1)
      .sort((left, right) =>
        compareCodePoints(left.target.definitionId, right.target.definitionId),
      )
      .map((entry) => Object.freeze(entry)),
  );
  return {
    entries,
    invalidTargetCount: prompts.length - projected.length,
    collisionTargetCount,
  };
}

function projectPrompt(
  candidate: AnyPrompt,
): ActivePromptCatalogueEntry | undefined {
  if (
    candidate._tag !== "Prompt" ||
    !candidate.id ||
    candidate.config.messages !== undefined
  ) {
    return undefined;
  }
  const input = inputDescriptor(candidate);
  if (!input) return undefined;
  const target = PromptPreviewTargetSchema.safeParse({
    definitionId: promptDefinitionRef(candidate.id).id,
    kind: "prompt",
    name: candidate.id,
    ...(candidate.description ? { description: candidate.description } : {}),
    input,
  });
  if (!target.success) return undefined;
  return { prompt: candidate, target: target.data };
}

function inputDescriptor(
  prompt: AnyPrompt,
): PromptPreviewTarget["input"] | undefined {
  if (!prompt.inputSchema) return { mode: "none" };
  try {
    const schema = toCanonicalJsonSchema(prompt.inputSchema);
    const parsed = StrictJsonObjectSchema.safeParse(schema);
    if (!parsed.success) return { mode: "raw" };
    if (compactJson(parsed.data).bytes > PROMPT_PREVIEW_MAX_SCHEMA_BYTES) {
      return undefined;
    }
    return { mode: "schema", schema: parsed.data };
  } catch {
    return { mode: "raw" };
  }
}

function retirement(owner: PromptCatalogueOwner): () => void {
  let retired = false;
  return () => {
    if (retired) return;
    retired = true;
    retirePromptCatalogue(owner);
  };
}

function compareCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left, (value) => value.codePointAt(0)!);
  const rightPoints = Array.from(right, (value) => value.codePointAt(0)!);
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    if (leftPoints[index] !== rightPoints[index]) {
      return leftPoints[index]! - rightPoints[index]!;
    }
  }
  return leftPoints.length - rightPoints.length;
}
