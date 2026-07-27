/**
 * Transactional provider-visible tool exposure evaluation.
 *
 * @internal
 * @module
 */

import type { ToolDescriptor } from "../session";
import type {
  ToolDefinitionOrigin,
  ToolDefinitionSubject,
} from "../../../safety";
import { cloneAndFreeze, guardSchemaDescriptions } from "./traversal";
import type { ToolExposureGuards, ToolExposureProvenance } from "./types";

interface ToolExposureCandidate {
  readonly descriptor: ToolDescriptor;
  readonly provenance: ToolExposureProvenance;
}

interface ToolExposureProjection {
  readonly stripped: boolean;
  readonly description: string;
  readonly parameters: Readonly<Record<string, unknown>>;
}

interface CachedProjection {
  readonly fingerprint: string;
  readonly projection: ToolExposureProjection;
}

/** Stateful evaluator that reuses unchanged skill-rearmed definitions. */
export interface ToolExposureEvaluator {
  evaluate(
    candidates: readonly ToolExposureCandidate[],
    guards: ToolExposureGuards,
  ): Promise<readonly ToolDescriptor[]>;
}

/** Create one exposure evaluator for a single tool lifecycle. */
export function createToolExposureEvaluator(): ToolExposureEvaluator {
  let cache = new Map<string, CachedProjection>();

  return {
    async evaluate(candidates, guards) {
      const nextCache = new Map<string, CachedProjection>();
      const exposed: ToolDescriptor[] = [];

      for (const candidate of candidates) {
        const fingerprint = exposureFingerprint(candidate);
        const previous = cache.get(candidate.descriptor.name);
        const projection =
          previous?.fingerprint === fingerprint
            ? previous.projection
            : await evaluateCandidate(candidate, guards);
        nextCache.set(candidate.descriptor.name, {
          fingerprint,
          projection,
        });
        if (projection.stripped) continue;
        exposed.push({
          ...candidate.descriptor,
          description: projection.description,
          parameters: projection.parameters as Record<string, unknown>,
        });
      }

      cache = nextCache;
      return exposed;
    },
  };
}

async function evaluateCandidate(
  candidate: ToolExposureCandidate,
  guards: ToolExposureGuards,
): Promise<ToolExposureProjection> {
  const origin = definitionOrigin(
    candidate.descriptor.name,
    candidate.provenance,
  );
  const subject = cloneAndFreeze<ToolDefinitionSubject>({
    name: candidate.descriptor.name,
    description: candidate.descriptor.description,
    parameters: candidate.descriptor.parameters,
  });
  const root = await guards.root(subject, origin);
  if (root.action === "strip") {
    return {
      stripped: true,
      description: candidate.descriptor.description,
      parameters: candidate.descriptor.parameters,
    };
  }

  const descriptionResult = await guards.descriptions(
    candidate.descriptor.description,
    { ...origin, descriptionKind: "tool" },
  );
  const description =
    descriptionResult.action === "rewrite"
      ? descriptionResult.value
      : candidate.descriptor.description;
  const parameters = await guardSchemaDescriptions({
    schema: candidate.descriptor.parameters,
    origin,
    guard: guards.descriptions,
  });
  return { stripped: false, description, parameters };
}

function definitionOrigin(
  toolName: string,
  provenance: ToolExposureProvenance,
): ToolDefinitionOrigin {
  return provenance.kind === "discovered"
    ? {
        source: "tool-definition",
        kind: "discovered",
        toolName,
        sourceId: provenance.sourceId,
        sourceKind: provenance.sourceKind,
      }
    : { source: "tool-definition", kind: "authored", toolName };
}

function exposureFingerprint(candidate: ToolExposureCandidate): string {
  return JSON.stringify({
    name: candidate.descriptor.name,
    description: candidate.descriptor.description,
    parameters: candidate.descriptor.parameters,
    provenance: candidate.provenance,
  });
}
