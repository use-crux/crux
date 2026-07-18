import { context } from "@use-crux/core";
import { z } from "zod";

export const pureContext = context({
  id: "pure-context",
  system: "Use verified support facts.",
});

export const schemaTools = {
  lookup: {
    description: "Look up a support fact.",
    inputSchema: z.object({ id: z.string() }),
  },
};

export const effectfulContext = context({
  input: z.object({ question: z.string() }),
  system: "Use runtime tools.",
  tools: () => schemaTools,
});
