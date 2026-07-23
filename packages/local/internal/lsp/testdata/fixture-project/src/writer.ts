import { prompt } from "@use-crux/core";
import { z } from "zod";

/** Supplies input typing while deliberately remaining uncovered by an Eval. */
export const writer = prompt({
  id: "lsp-fixture-writer",
  input: z.object({ request: z.string() }),
  system: "Write a concise fixture response.",
});
