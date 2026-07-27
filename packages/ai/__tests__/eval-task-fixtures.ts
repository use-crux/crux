import type { LanguageModel } from "ai";

/** Minimal language-model identity used by managed Eval task tests. */
export function evalTaskModel(modelId = "gpt-4o"): LanguageModel {
  return {
    provider: "openai",
    modelId,
    specificationVersion: "v3",
  } as unknown as LanguageModel;
}
