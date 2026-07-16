import type { StandardSchemaV1 } from "../../quality/standard-schema";
import type { AnyEval } from "../../eval/evaluate";
import type { RawEvalCase } from "../../eval/internal/definition";
import type { EvalPlannedArm } from "../../eval/internal/types";

/** One generated, schema-validated Case retained by a deployed Eval. */
export interface DeployedEvalCase {
  readonly id: string;
  readonly fingerprint: string;
  readonly authored: RawEvalCase;
}

/** One Current or authored Variant identity in a deployed Eval. */
export interface DeployedEvalVariant {
  readonly name: string;
  readonly fingerprint: string;
}

/** Project Index evidence used only to corroborate generated source facts. */
export interface DeployedEvalIndexFacts {
  readonly id: string;
  readonly source: string;
  readonly requiredHostCapabilities: readonly string[];
}

/** Generated input for one allowlisted deployed Eval. */
export interface DeployedEvalRegistryEntryInput {
  readonly eval: AnyEval;
  readonly id: string;
  readonly source: string;
  readonly evalFingerprint: string;
  readonly cases: readonly DeployedEvalCase[];
  readonly variants: readonly DeployedEvalVariant[];
  readonly requiredHostCapabilities: readonly string[];
  readonly index: DeployedEvalIndexFacts;
}

/** Frozen executable entry retained by the deployed registry. */
export interface DeployedEvalRegistryEntry extends Omit<
  DeployedEvalRegistryEntryInput,
  "eval" | "index"
> {
  readonly eval: AnyEval;
  readonly schemas: Readonly<{
    readonly input?: StandardSchemaV1;
    readonly output?: StandardSchemaV1;
  }>;
  readonly arms: readonly EvalPlannedArm[];
}

/** Immutable generated Eval allowlist. */
export interface DeployedEvalRegistry {
  readonly _tag: "CruxDeployedEvalRegistry";
  readonly entries: readonly DeployedEvalRegistryEntry[];
}

/** Exact identity tuple accepted before deployed inference can begin. */
export interface ResolveDeployedEvalRequest {
  readonly evalId: string;
  readonly evalFingerprint: string;
  readonly caseId: string;
  readonly caseFingerprint: string;
  readonly variant: string;
  readonly variantFingerprint: string;
}

/** Executable Case and arm resolved from one exact deployed tuple. */
export interface ResolvedDeployedEval {
  readonly entry: DeployedEvalRegistryEntry;
  readonly case: DeployedEvalCase;
  readonly variant: EvalPlannedArm;
}
