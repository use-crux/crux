/**
 * Compile-time contract for Convex Agent model support.
 */

import { z } from "zod";
import { prompt } from "../index";
import { convexAgent } from "../agent";
import { router } from "@use-crux/core/routing";

const supportPrompt = prompt({
  id: "convex-routing-rejection",
  input: z.object({ instruction: z.string() }),
  system: "Answer briefly.",
});

const routed = router({
  classify: () => "fast" as const,
  routes: {
    fast: "gpt-4o-mini",
    default: "gpt-4o-mini",
  },
});

convexAgent({
  components: {
    crux: { crux: true } as never,
    agent: { agent: true } as never,
  },
  prompt: supportPrompt,
  // @ts-expect-error Convex Agent forwards LanguageModelV3 and does not resolve routing wrappers.
  languageModel: routed,
});

convexAgent({
  components: {
    crux: { crux: true } as never,
    agent: { agent: true } as never,
  },
  prompt: supportPrompt,
  // @ts-expect-error The legacy `model` alias also remains LanguageModelV3-only.
  model: routed,
});
