import { prompt } from "@use-crux/core";

// crux-lint-disable-next-line prompt.missing_input_schema -- fixture coverage
export const suppressedWriter = prompt({
  id: "lsp-fixture-suppressed-writer",
  system: "Write a suppressed fixture response.",
});
