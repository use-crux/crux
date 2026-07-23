import { prompt, tool } from "@use-crux/core";
import { writerInput } from "./schema";

/** Prompt targeted by the fixture agent's prompt relation. */
export const writerPrompt = prompt({
  id: "lsp-navigation-writer",
  input: writerInput,
  system: "Write a concise fixture response.",
});

/** Tool targeted by the fixture agent's tool relation. */
export const outlineTool = tool({
  name: "lsp-navigation-outline",
  description: "Create a concise outline.",
  execute: async () => "outline",
});
