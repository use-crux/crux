import type { GoogleGenAI } from "@google/genai";
import { describe, expect, it } from "vitest";
import { prompt } from "@use-crux/core";
import { router } from "@use-crux/core/routing";
import { createGoogle } from "../src/native";

const routed = router({
  classify: () => "fast" as const,
  routes: {
    fast: "gemini-2.5-flash",
    default: "gemini-2.5-flash",
  },
});

const supportPrompt = prompt({
  id: "google-routing-rejection",
  system: "Answer briefly.",
});

declare const client: GoogleGenAI;

describe("Google native adapter routing support", () => {
  it("keeps wrappers rejected at the model option", () => {
    if (false) {
      const google = createGoogle(client, { cachedContent: false });
      // @ts-expect-error Google's native single-turn adapter accepts string model ids, not routing wrappers.
      void google.generate(supportPrompt, { model: routed });
    }

    expect(true).toBe(true);
  });
});
