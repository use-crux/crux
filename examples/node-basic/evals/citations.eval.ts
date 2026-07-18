import { evaluate } from "@use-crux/core/eval";
import { support } from "../support";

export default evaluate({
  id: "examples.support-citations",
  task: support,
  cases: [
    {
      id: "refund-policy",
      input: { question: "How do refunds work?" },
      expected: { answer: "", citations: ["policy-refunds"] },
    },
  ],
  expect: ({ output, expected, expect }) => {
    expect(output.citations).toContain(expected.citations[0]);
  },
});
