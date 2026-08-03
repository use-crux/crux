import type {
  GenerationAdapterIdentity,
  GenerationModelDefinition,
  NormalizedGenerationIdentity,
} from "./contract";

function required(value: string, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${field} must not be empty.`);
  }
  return value;
}

export function freezeAdapterIdentity(
  identity: GenerationAdapterIdentity,
): GenerationAdapterIdentity {
  return Object.freeze({
    id: required(identity.id, "Generation adapter id"),
    version: required(identity.version, "Generation adapter version"),
  });
}

export function freezeModelDefinition(
  definition: GenerationModelDefinition,
): GenerationModelDefinition {
  return Object.freeze({
    id: required(definition.id, "Generation model definition id"),
    fingerprint: required(
      definition.fingerprint,
      "Generation model definition fingerprint",
    ),
  });
}

export function freezeNormalizedIdentity(
  identity: NormalizedGenerationIdentity,
): NormalizedGenerationIdentity {
  if (identity.kind === "model") {
    return Object.freeze({
      kind: "model",
      model: required(identity.model, "Normalized model identity"),
    });
  }
  return Object.freeze({
    kind: "router",
    router: required(identity.router, "Normalized router identity"),
    routes: Object.freeze(
      identity.routes.map((route) =>
        Object.freeze({
          key: required(route.key, "Normalized route key"),
          target: required(route.target, "Normalized route target"),
        }),
      ),
    ),
  });
}
