import { describe, expect, it } from "vitest";
import {
  configure,
  prompt,
  type ConfigureOptions,
  type PromptRegistry,
} from "@use-crux/core";
import * as runtimeEngine from "@use-crux/core/runtime";

describe("public exact-preview catalogue authority", () => {
  it("exports configure from the package root only", () => {
    const options = {
      prompts: [prompt({ id: "public-preview", prompt: "Hello" })],
    } satisfies ConfigureOptions;
    const registry: PromptRegistry = configure(options);

    try {
      expect(registry.get("public-preview").id).toBe("public-preview");
      expect("configure" in runtimeEngine).toBe(false);
    } finally {
      registry.dispose();
    }
  });
});
