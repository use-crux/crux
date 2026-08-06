import { isAgent } from "../agent";
import type { GenerationModel } from "../generation-model";
import type { RuntimeProgramTarget } from "./program";

/** Canonicalize explicit declarations together with Agent-owned defaults. */
export function canonicalizeProgramGenerationModels(
  declared: readonly GenerationModel[],
  targets: readonly RuntimeProgramTarget[],
): readonly GenerationModel[] {
  const models = [...declared];
  for (const target of targets) {
    if (isAgent(target) && isGenerationModel(target.model)) {
      models.push(target.model);
    }
  }
  models.sort(compareModels);
  const canonical: GenerationModel[] = [];
  for (const model of models) {
    const previous = canonical.at(-1);
    if (previous && compareModels(previous, model) === 0) {
      if (previous !== model) {
        throw new TypeError(
          `GenerationModel "${model.definition.id}" is declared more than once.`,
        );
      }
      continue;
    }
    canonical.push(model);
  }
  return Object.freeze(canonical);
}

/** Return safe Core metadata for Runtime manifest hashing. */
export function generationModelManifestEntry(model: GenerationModel) {
  return {
    adapter: model.adapter,
    definition: model.definition,
    identity: model.identity,
    capabilities: model.capabilities,
  };
}

/** Return the Agent-owned default binding associated with one target. */
export function targetGenerationModelReference(target: RuntimeProgramTarget) {
  if (!isAgent(target) || !isGenerationModel(target.model)) return undefined;
  return {
    definitionId: target.model.definition.id,
    fingerprint: target.model.definition.fingerprint,
  };
}

function compareModels(left: GenerationModel, right: GenerationModel): number {
  return (
    compareText(left.definition.id, right.definition.id) ||
    compareText(left.definition.fingerprint, right.definition.fingerprint)
  );
}

function isGenerationModel(value: unknown): value is GenerationModel {
  return (
    typeof value === "object" &&
    value !== null &&
    "_tag" in value &&
    value._tag === "crux.generation-model"
  );
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
