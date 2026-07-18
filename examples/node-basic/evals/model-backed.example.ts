/**
 * A second managed task and Variant example.
 *
 * Rename this file to `concise.eval.ts` if you want the CLI to discover it.
 * The invocation uses the provider credentials from the normal environment.
 *
 * @module
 */

import { evaluate } from "@use-crux/core/eval";
import { conciseSupport } from "../support";

export default evaluate({
  id: "examples.concise-support",
  task: conciseSupport,
  cases: [
    {
      id: "refund",
      input: { question: "How do refunds work?" },
    },
  ],
  variants: {
    deterministic: { temperature: 0 },
  },
  expect: ({ output, expect }) => {
    expect(output.answer.length).toBeGreaterThan(0);
  },
});
