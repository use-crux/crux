import { agent } from "@use-crux/core";
import { outlineTool, writerPrompt } from "./primitives";

/** Connects authored references to both target definitions for LSP navigation. */
export const writerAgent = agent({
  name: "LSP Navigation Writer",
  prompt: writerPrompt,
  tools: { outline: outlineTool },
});
