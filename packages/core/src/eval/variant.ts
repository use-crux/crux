/**
 * Shallow compile-time validation for authored Eval Variants.
 *
 * Only authored keys are inspected. Replacement prompts, models, and managed
 * tasks are checked by semantic variance without importing provider types.
 *
 * @internal
 * @module
 */

import type { z } from "zod";

import type { AnyPrompt } from "../prompt";
import type {
  BoundOk,
  InputOk,
  PromptInputOf,
  PromptOutputSchemaOf,
  RoutingCallOptions,
} from "../routing";
import type { CallOf, InputOf, OutputOf } from "./task";

type PromptEvalOutput<TPrompt> =
  PromptOutputSchemaOf<TPrompt> extends infer TSchema
    ? [TSchema] extends [undefined]
      ? string
      : TSchema extends z.ZodType
        ? z.output<TSchema>
        : never
    : never;

type CompatiblePromptOverride<TPrompt, TInput, TOutput> =
  TPrompt extends AnyPrompt
    ? [TInput] extends [PromptInputOf<TPrompt>]
      ? [PromptEvalOutput<TPrompt>] extends [TOutput]
        ? TPrompt
        : {
            readonly "crux-eval error": "Variant prompt output is not assignable to the task output";
            readonly produces: PromptEvalOutput<TPrompt>;
          }
      : {
          readonly "crux-eval error": "Variant prompt does not accept the task input";
          readonly accepts: PromptInputOf<TPrompt>;
        }
    : {
        readonly "crux-eval error": "Variant prompt must be a Crux prompt";
      };

type BasePromptOf<TSurface extends object> = TSurface extends {
  readonly prompt?: infer TPrompt;
}
  ? Exclude<TPrompt, undefined>
  : never;

type EffectivePrompt<
  TVariant,
  TSurface extends object,
> = "prompt" extends keyof TVariant
  ? TVariant extends { readonly prompt: infer TPrompt }
    ? TPrompt
    : BasePromptOf<TSurface>
  : BasePromptOf<TSurface>;

type SupportedModelOf<TSurface extends object> = TSurface extends {
  readonly model?: infer TModel;
}
  ? Exclude<TModel, undefined>
  : never;

type CompatibleModelOverride<
  TModel,
  TInput,
  TCall extends object,
  TSurface extends object,
  TPrompt,
> = [TModel] extends [SupportedModelOf<TSurface>]
  ? unknown extends InputOk<TModel, TInput>
    ? unknown extends BoundOk<TModel, TPrompt>
      ? [TCall] extends [RoutingCallOptions<TModel>]
        ? TModel
        : {
            readonly "crux-eval error": "Variant model requires call context not accepted by the base task";
            readonly requires: RoutingCallOptions<TModel>;
          }
      : {
          readonly "crux-eval error": "Variant model is bound to a different prompt";
        }
    : {
        readonly "crux-eval error": "Variant model does not accept the task input";
      }
  : {
      readonly "crux-eval error": "Variant model is not supported by the task adapter";
    };

type CompatibleTaskOverride<
  TTask,
  TInput,
  TOutput,
  TCall extends object,
> = TTask extends { readonly _tag: "CruxTask" }
  ? [TInput] extends [InputOf<TTask>]
    ? [OutputOf<TTask>] extends [TOutput]
      ? [TCall] extends [CallOf<TTask>]
        ? TTask
        : {
            readonly "crux-eval error": "Variant task does not accept the base Case call contract";
            readonly accepts: CallOf<TTask>;
          }
      : {
          readonly "crux-eval error": "Variant task output is not assignable to the task output";
          readonly produces: OutputOf<TTask>;
        }
    : {
        readonly "crux-eval error": "Variant task does not accept the task input";
        readonly accepts: InputOf<TTask>;
      }
  : {
      readonly "crux-eval error": "Variant task must be a managed Eval task";
    };

type ValidateVariantEntry<
  TVariant,
  TSurface extends object,
  TInput,
  TOutput,
  TCall extends object,
> = {
  [K in keyof TVariant]: K extends "prompt"
    ? "prompt" extends keyof TSurface
      ? CompatiblePromptOverride<TVariant[K], TInput, TOutput>
      : never
    : K extends "model"
      ? "model" extends keyof TSurface
        ? CompatibleModelOverride<
            TVariant[K],
            TInput,
            TCall,
            TSurface,
            EffectivePrompt<TVariant, TSurface>
          >
        : never
      : K extends "task"
        ? "task" extends keyof TSurface
          ? CompatibleTaskOverride<TVariant[K], TInput, TOutput, TCall>
          : never
        : K extends keyof TSurface
          ? TSurface[K]
          : never;
};

/** Validate authored Variant names and their shallow override properties. */
export type ValidateEvalVariants<
  TVariants,
  TSurface extends object,
  TInput,
  TOutput,
  TCall extends object,
> = {
  [K in keyof TVariants]: K extends "current" | "baseline"
    ? never
    : ValidateVariantEntry<TVariants[K], TSurface, TInput, TOutput, TCall>;
};
