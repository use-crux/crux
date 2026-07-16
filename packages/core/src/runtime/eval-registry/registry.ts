import { getEvalDefinitionForInternalUse } from "../../eval/internal/definition";
import { fingerprintEvalValue } from "../../eval/internal/identity";
import {
  getEvalTaskSchemasForInternalUse,
  materializeEvalForInternalUse,
} from "../../eval/internal/runner";
import { resolveEvalArms } from "../../eval/internal/arm-policy";
import { registryError } from "./error";
import {
  fingerprintDeployedEvalCase,
  projectDeployedEvalRequiredHostCapabilities,
} from "./projection";
import type {
  DeployedEvalRegistry,
  DeployedEvalRegistryEntry,
  DeployedEvalRegistryEntryInput,
  ResolveDeployedEvalRequest,
  ResolvedDeployedEval,
} from "./types";

/** Validate and freeze a generated deployed Eval allowlist. */
export function createDeployedEvalRegistry(input: {
  readonly entries: readonly DeployedEvalRegistryEntryInput[];
}): DeployedEvalRegistry {
  const entries = input.entries.map(normalizeEntry);
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.id)) {
      registryError(
        "registry_invalid",
        `Deployed Eval registry repeats '${entry.id}'.`,
      );
    }
    seen.add(entry.id);
  }
  return Object.freeze({
    _tag: "CruxDeployedEvalRegistry" as const,
    entries: Object.freeze(entries),
  });
}

/** Resolve an exact generated identity tuple before exposing executable code. */
export function resolveDeployedEval(
  registry: DeployedEvalRegistry,
  request: ResolveDeployedEvalRequest,
): ResolvedDeployedEval {
  const entry = registry.entries.find(
    (candidate) => candidate.id === request.evalId,
  );
  if (entry === undefined) {
    registryError(
      "eval_missing",
      `Deployed Eval '${request.evalId}' is not registered.`,
    );
  }
  if (entry.evalFingerprint !== request.evalFingerprint) {
    registryError(
      "eval_stale",
      `Deployed Eval '${request.evalId}' has a stale Eval fingerprint.`,
    );
  }
  const evalCase = entry.cases.find(
    (candidate) => candidate.id === request.caseId,
  );
  if (evalCase === undefined) {
    registryError(
      "case_missing",
      `Case '${request.caseId}' is not registered for Eval '${request.evalId}'.`,
    );
  }
  if (evalCase.fingerprint !== request.caseFingerprint) {
    registryError(
      "case_stale",
      `Case '${request.caseId}' has a stale fingerprint.`,
    );
  }
  const identity = entry.variants.find(
    (candidate) => candidate.name === request.variant,
  );
  const variant = entry.arms.find(
    (candidate) => candidate.name === request.variant,
  );
  if (identity === undefined || variant === undefined) {
    registryError(
      "variant_missing",
      `Variant '${request.variant}' is not registered for Eval '${request.evalId}'.`,
    );
  }
  if (identity.fingerprint !== request.variantFingerprint) {
    registryError(
      "variant_stale",
      `Variant '${request.variant}' has a stale fingerprint.`,
    );
  }
  return Object.freeze({ entry, case: evalCase, variant });
}

function normalizeEntry(
  input: DeployedEvalRegistryEntryInput,
): DeployedEvalRegistryEntry {
  assertIndexAgreement(input);
  const definition = getEvalDefinitionForInternalUse(input.eval);
  if (
    definition.explicitId !== undefined &&
    definition.explicitId !== input.id
  ) {
    registryError(
      "registry_invalid",
      `Imported Eval '${definition.explicitId}' does not match generated id '${input.id}'.`,
    );
  }
  const projectedCapabilities = projectDeployedEvalRequiredHostCapabilities(
    input.eval,
  );
  if (
    JSON.stringify(projectedCapabilities) !==
    JSON.stringify(sorted(input.requiredHostCapabilities))
  ) {
    registryError(
      "registry_invalid",
      `Generated host capabilities for Eval '${input.id}' disagree with its managed task definitions.`,
    );
  }
  const cases = Object.freeze(
    input.cases.map((entry) => {
      const fingerprint = fingerprintDeployedEvalCase(entry.id, entry.authored);
      if (fingerprint !== entry.fingerprint) {
        registryError(
          "registry_invalid",
          `Generated Case '${entry.id}' fingerprint is incompatible with its embedded data.`,
        );
      }
      const imported = definition.cases.find(
        (candidate) =>
          (candidate.id ?? fingerprintEvalValue(candidate.input)) === entry.id,
      );
      return Object.freeze({
        ...entry,
        authored: Object.freeze({
          ...entry.authored,
          ...(imported?.expect !== undefined
            ? { expect: imported.expect }
            : {}),
          ...(imported?.afterScores !== undefined
            ? { afterScores: imported.afterScores }
            : {}),
          ...(imported?.metadata !== undefined
            ? { metadata: imported.metadata }
            : {}),
        }),
      });
    }),
  );
  const evalValue = materializeEvalForInternalUse(input.eval, {
    id: input.id,
    cases: cases.map((entry) => entry.authored),
  });
  const arms = resolveEvalArms(getEvalDefinitionForInternalUse(evalValue));
  if (!sameVariants(input.variants, arms)) {
    registryError(
      "registry_invalid",
      `Generated Variant fingerprints for Eval '${input.id}' are incompatible with the imported definition.`,
    );
  }
  const taskSchemas = getEvalTaskSchemasForInternalUse(evalValue);
  return Object.freeze({
    eval: evalValue,
    id: input.id,
    source: input.source,
    evalFingerprint: input.evalFingerprint,
    cases,
    variants: Object.freeze(
      input.variants.map((entry) => Object.freeze({ ...entry })),
    ),
    requiredHostCapabilities: Object.freeze([
      ...input.requiredHostCapabilities,
    ]),
    schemas: Object.freeze({
      ...(taskSchemas.inputSchema !== undefined
        ? { input: taskSchemas.inputSchema }
        : {}),
      ...(taskSchemas.outputSchema !== undefined
        ? { output: taskSchemas.outputSchema }
        : {}),
    }),
    arms,
  });
}

function assertIndexAgreement(input: DeployedEvalRegistryEntryInput): void {
  const actual = [
    input.id,
    input.source,
    sorted(input.requiredHostCapabilities),
  ];
  const indexed = [
    input.index.id,
    input.index.source,
    sorted(input.index.requiredHostCapabilities),
  ];
  if (JSON.stringify(actual) !== JSON.stringify(indexed)) {
    registryError(
      "index_disagreement",
      `Project Index corroboration disagrees with generated Eval '${input.id}' required capabilities (${input.requiredHostCapabilities.join(", ") || "none"}). Run crux index reindex, then crux runtime generate.`,
    );
  }
}

function sameVariants(
  identities: DeployedEvalRegistryEntryInput["variants"],
  arms: ReturnType<typeof resolveEvalArms>,
): boolean {
  return (
    identities.length === arms.length &&
    identities.every((entry, index) => {
      const arm = arms[index];
      return (
        arm !== undefined &&
        entry.name === arm.name &&
        entry.fingerprint === arm.fingerprint
      );
    })
  );
}

function sorted(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort(compareCodepoint);
}

function compareCodepoint(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
