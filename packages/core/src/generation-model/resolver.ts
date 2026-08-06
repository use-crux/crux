import type { GenerationModel } from "./contract";

/** Durable reference selecting one statically declared GenerationModel. */
export interface GenerationModelReference {
  readonly definitionId: string;
  readonly fingerprint: string;
}

/** Immutable resolver scoped to one Runtime program declaration. */
export type GenerationModelResolver = (
  reference: GenerationModelReference,
) => GenerationModel | undefined;

/** Create a pure pinned-reference resolver over immutable model declarations. */
export function createGenerationModelResolver(
  models: readonly GenerationModel[],
): GenerationModelResolver {
  const declarations = Object.freeze([...models]);
  return (reference) =>
    declarations.find(
      (model) =>
        model.definition.id === reference.definitionId &&
        model.definition.fingerprint === reference.fingerprint,
    );
}
