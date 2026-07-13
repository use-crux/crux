import { expectTypeOf } from "vitest";
import {
  bindCompletedOperation,
  defineCompletedOperation,
  runCompletedMediaOperation,
} from "@use-crux/core/adapter";
import { router, type RouteArgs } from "@use-crux/core/routing";
// @ts-expect-error - support evidence stays private to operation definitions.
import type { Support } from "@use-crux/core/adapter";
// @ts-expect-error - completed operations intentionally expose no cache contract.
import type { CompletedOperationCache } from "@use-crux/core/adapter";

const completedInput: Readonly<{ text: string }> = { text: "hello" };

const definition = defineCompletedOperation({
  normalize: (input: Readonly<{ text: string }>) => ({
    text: input.text.trim(),
  }),
  support: () => "unknown" as const,
  invoke: async (
    input,
    context: Readonly<{ model: string; signal: AbortSignal }>,
  ) => ({
    text: input.text,
    model: context.model,
  }),
  validate: (raw) => ({
    text: raw.text,
    warnings: [] as const,
    execution: { kind: "native" as const, calls: 1 },
    raw,
  }),
  report: (result) => ({ textLength: result.text.length }),
  conformance: [
    { name: "future model", model: "future-model", input: completedInput },
  ],
});

expectTypeOf<Parameters<typeof definition.normalize>[0]>().toEqualTypeOf<
  Readonly<{ text: string }>
>();
expectTypeOf(definition.support).returns.toEqualTypeOf<
  "supported" | "unsupported" | "unknown"
>();
expectTypeOf(definition.invoke).returns.toEqualTypeOf<
  Promise<{ text: string; model: string }>
>();

const result = runCompletedMediaOperation({
  definition,
  provider: "test",
  operation: "media.test",
  model: "future-model",
  input: { text: "hello" },
});
expectTypeOf(result).toEqualTypeOf<
  Promise<{
    text: string;
    warnings: readonly [];
    execution: { kind: "native"; calls: number };
    raw: { text: string; model: string };
  }>
>();

const boundDefinition = defineCompletedOperation({
  normalize: (input: Readonly<{ model: string; text: string }>) => ({
    text: input.text.trim(),
  }),
  support: definition.support,
  invoke: definition.invoke,
  validate: definition.validate,
  report: definition.report,
  conformance: [],
});
const bound = bindCompletedOperation({
  definition: boundDefinition,
  provider: "test",
  operation: "media.test",
});
void bound({ model: "future-model", text: "hello" });
const routedModel = router({
  classify: ({ context }: RouteArgs<{ readonly tier: "pro" | "free" }>) =>
    context.tier,
  routes: { pro: "pro-model", free: "free-model", default: "free-model" },
});
void bound({
  model: routedModel,
  text: "hello",
  routing: { tier: "pro" },
  route: "pro",
});
// @ts-expect-error - routed completed operations require classifier context.
void bound({ model: routedModel, text: "hello" });
// @ts-expect-error - model operations never accept persistence dependencies.
void bound({ model: "future-model", text: "hello", store: {} });
