/**
 * `evaluate()` — define one inert Eval.
 *
 * The task is the sole inference anchor for Case input, semantic output, call
 * options, and capabilities. Defining an Eval performs no model, filesystem,
 * or host work.
 *
 * @module
 */

import type { ProjectDefinitionKind } from "../project-index";
import type { BoundScorerLib, Scorer } from "../quality/scorers";
import type { EvaluationCoverageTargetId } from "../quality/internal/definition";
import type { EvalCase } from "./case";
import type { CaseFile } from "./case-file";
import type { EvalGates } from "./gates";
import type {
  CallOf,
  CapsOf,
  EvalTaskLike,
  InputOf,
  OutputOf,
  ResponseOf,
  VariantOf,
} from "./task";
import type { ValidateEvalVariants } from "./variant";
import { EVAL_INTERNAL, type EvalDefinitionV1 } from "./internal/definition";
import { normalizeEvalDefinition } from "./internal/normalize-definition";

/** Project Index definition id that an Eval is intended to cover. */
export type EvalCoverageTargetId<
  TKind extends ProjectDefinitionKind = ProjectDefinitionKind,
> = EvaluationCoverageTargetId<TKind>;

/** Literal name carried by one statically named scorer. @internal */
type ScorerElementName<S> = S extends { readonly scorerName?: infer N }
  ? N extends string
    ? string extends N
      ? string
      : N
    : string
  : string;

/** Literal scorer names declared by an authored scorer tuple. @internal */
type ScorerNamesOf<TScorers> = TScorers extends readonly (infer S)[]
  ? ScorerElementName<S>
  : never;

/** Task projections cached behind short aliases for public diagnostics. */
type TaskInput<TTask> = InputOf<TTask>;
type TaskOutput<TTask> = OutputOf<TTask>;
type TaskCall<TTask> = CallOf<TTask>;
type TaskVariant<TTask> = VariantOf<TTask>;
type TaskCapabilities<TTask> = CapsOf<TTask>;
type TaskResponse<TTask> = ResponseOf<TTask>;

/** Options accepted by the inert Phase 1 authoring surface. */
export interface EvaluateOptions<
  TTask extends EvalTaskLike,
  TExpected,
  TScorers extends readonly Scorer<
    TaskInput<TTask>,
    TaskOutput<TTask>,
    NoInfer<TExpected>,
    string
  >[],
  TVariants extends Readonly<Record<string, Readonly<Record<string, unknown>>>>,
  TId extends string | undefined,
> {
  id?: TId;
  task: TTask;
  cases:
    | readonly (
        | EvalCase<
            TaskInput<TTask>,
            TaskOutput<TTask>,
            TExpected,
            TaskCall<TTask>,
            TaskCapabilities<TTask>,
            ScorerNamesOf<TScorers>,
            TaskResponse<TTask>
          >
        | CaseFile<NoInfer<TaskInput<TTask>>, unknown>
      )[]
    | CaseFile<NoInfer<TaskInput<TTask>>, unknown>;
  variants?: TVariants &
    ValidateEvalVariants<
      TVariants,
      TaskVariant<TTask>,
      TaskInput<TTask>,
      TaskOutput<TTask>,
      TaskCall<TTask>
    >;
  expect?: EvalCase<
    TaskInput<TTask>,
    TaskOutput<TTask>,
    TExpected,
    TaskCall<TTask>,
    TaskCapabilities<TTask>,
    string,
    TaskResponse<TTask>
  >["expect"];
  afterScores?: EvalCase<
    TaskInput<TTask>,
    TaskOutput<TTask>,
    TExpected,
    TaskCall<TTask>,
    TaskCapabilities<TTask>,
    ScorerNamesOf<TScorers>,
    TaskResponse<TTask>
  >["afterScores"];
  scorers?:
    | TScorers
    | ((
        scorers: BoundScorerLib<
          TaskInput<TTask>,
          TaskOutput<TTask>,
          NoInfer<TExpected>
        >,
      ) => TScorers);
  gates?: EvalGates<ScorerNamesOf<TScorers> | "pass">;
  trials?: number;
  tags?: readonly string[];
  description?: string;
  covers?: readonly EvalCoverageTargetId[];
}

/**
 * An immutable Eval definition discovered and executed by external
 * coordinators. It intentionally has no execution or promotion methods.
 */
export interface Eval<
  I = unknown,
  O = unknown,
  ScoreName extends string = string,
  VariantName extends string = never,
  Id extends string | undefined = string | undefined,
> {
  readonly _tag: "CruxEval";
  readonly id: Id;
  readonly __types?: {
    readonly input: (value: I) => void;
    readonly output: () => O;
    readonly scoreName: () => ScoreName;
    readonly variantName: () => VariantName;
  };
  readonly [EVAL_INTERNAL]: EvalDefinitionV1;
}

/** Widest Eval type accepted by internal collection code. */
export type AnyEval = Eval<never, unknown, string, string, string | undefined>;

/** Return type assembled from one fully inferred authoring contract. */
type InferredEval<
  TTask,
  TScorers,
  TVariants,
  TId extends string | undefined,
> = Eval<
  TaskInput<TTask>,
  TaskOutput<TTask>,
  ScorerNamesOf<TScorers> | "pass",
  keyof TVariants & string,
  TId
>;

function createEval(options: unknown): AnyEval {
  const { id, definition } = normalizeEvalDefinition(options);
  const evalValue = {
    _tag: "CruxEval" as const,
    id,
  };
  Object.defineProperty(evalValue, EVAL_INTERNAL, {
    value: definition,
    enumerable: false,
  });
  return Object.freeze(evalValue) as AnyEval;
}

/**
 * Define a frozen, inert Eval from a production task and its Cases.
 *
 * @param options - Task, Cases, and optional checks or comparison Variants.
 * @returns A definition for CLI/Node discovery; no work is executed.
 */
export function evaluate<
  const TTask extends EvalTaskLike,
  const TExpected = unknown,
  const TScorers extends readonly Scorer<
    TaskInput<TTask>,
    TaskOutput<TTask>,
    NoInfer<TExpected>,
    string
  >[] = readonly [],
  const TVariants extends Readonly<
    Record<string, Readonly<Record<string, unknown>>>
  > = {},
  const TId extends string | undefined = undefined,
>(
  options: EvaluateOptions<TTask, TExpected, TScorers, TVariants, TId>,
): InferredEval<TTask, TScorers, TVariants, TId> {
  return createEval(options) as InferredEval<TTask, TScorers, TVariants, TId>;
}
