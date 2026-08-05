import { expectTypeOf } from "vitest";
import { z } from "zod";
import * as core from "../src";
import { prompt, session } from "../src";
import { agent } from "../src/agent";
import type {
  AdapterBoundGenerationModel,
  GenerationCapabilities,
  GenerationModel,
} from "../src";
import type { SessionForTarget } from "../src/session/target-types";
import { defineGenerationModel } from "../src/adapter-authoring";

expectTypeOf<AdapterBoundGenerationModel>().toMatchTypeOf<GenerationModel>();

const emptyOperations = {
  image: [],
  speech: [],
  transcription: [],
  embedding: [],
} as const;

function bound<const TCapabilities extends GenerationCapabilities>(
  capabilities: TCapabilities,
) {
  return defineGenerationModel({
    adapter: { id: "fixture", version: "1" },
    native: { id: "native" },
    definition: { id: "fixture:model", fingerprint: "fixture:model:v1" },
    identity: { kind: "model", model: "fixture-model" },
    capabilities,
    runtime: { createAgentExecutor: () => fail("not executed") },
  });
}

function fail(message: string): never {
  throw new Error(message);
}

const textModel = bound({
  contract: "crux.generation-capabilities.v1",
  language: ["text-input", "text-output"],
  ...emptyOperations,
});

const structuredModel = bound({
  contract: "crux.generation-capabilities.v1",
  language: ["text-input", "text-output", "structured-output"],
  ...emptyOperations,
});

const incompleteModel = bound({
  contract: "crux.generation-capabilities.v1",
  language: ["text-input"],
  ...emptyOperations,
});

const broadCapabilities: GenerationCapabilities = {
  contract: "crux.generation-capabilities.v1",
  language: ["text-input", "text-output"],
  ...emptyOperations,
};
const broadModel = bound(broadCapabilities);

const taskPrompt = prompt({
  id: "generation-model-task",
  input: z.object({ message: z.string() }),
  output: z.object({ reply: z.string() }),
  system: "Reply clearly.",
});

const boundAgent = agent({
  id: "bound",
  prompt: taskPrompt,
  model: structuredModel,
});
const unboundAgent = agent({ id: "unbound", prompt: taskPrompt });
const native = { modelId: "native-only" } as const;
const nativeAgent = agent({ id: "native", prompt: taskPrompt, model: native });

expectTypeOf(boundAgent.model).toEqualTypeOf<typeof structuredModel>();
expectTypeOf(unboundAgent.model).toEqualTypeOf<undefined>();
expectTypeOf(nativeAgent.model).toEqualTypeOf<typeof native>();

const boundSession = () => session(boundAgent, { key: "bound:1" });
const suppliedSession = () =>
  session(unboundAgent, { key: "unbound:1", model: structuredModel });
const nativeSession = () =>
  session(nativeAgent, { key: "native:1", model: structuredModel });
const broadSession = () =>
  session(unboundAgent, { key: "broad:1", model: broadModel });

expectTypeOf<
  Awaited<ReturnType<typeof boundSession>>
>().toEqualTypeOf<SessionForTarget<typeof boundAgent>>();
expectTypeOf<
  Awaited<ReturnType<typeof suppliedSession>>
>().toEqualTypeOf<SessionForTarget<typeof unboundAgent>>();
expectTypeOf<
  Awaited<ReturnType<typeof nativeSession>>
>().toEqualTypeOf<SessionForTarget<typeof nativeAgent>>();
expectTypeOf<
  Awaited<ReturnType<typeof broadSession>>
>().toEqualTypeOf<SessionForTarget<typeof unboundAgent>>();

if (false) {
  // @ts-expect-error Construction authority is absent from the application surface.
  core.defineGenerationModel;
  session(boundAgent, { key: "bound:override", model: structuredModel });

  // @ts-expect-error An unbound Agent requires a bound Session model.
  session(unboundAgent, { key: "unbound:missing" });
  // @ts-expect-error A raw native Agent model does not carry portable authority.
  session(nativeAgent, { key: "native:missing" });
  // @ts-expect-error Exact missing capabilities are rejected after model inference.
  session(unboundAgent, { key: "incomplete:1", model: incompleteModel });
  // @ts-expect-error Structured Agents reject exact text-only capability evidence.
  session(unboundAgent, { key: "text:1", model: textModel });
  // @ts-expect-error Session identity always requires a key.
  session(boundAgent, {});
}
