import { evaluate } from "@use-crux/core/eval";
import { supportTask } from "../src/support";

export default evaluate({
  id: "demo.support-quality",
  task: supportTask,
  cases: [
    {
      id: "refund-window",
      input: { question: "Can I refund my monthly plan after seven days?" },
      expected: { citations: ["policy-refunds"] },
    },
    {
      id: "unsupported-exception",
      input: { question: "Can support invent a refund exception?" },
      expected: { citations: ["policy-refunds"] },
    },
    {
      id: "account-lockout",
      input: { question: "How do I recover access to a locked account?" },
      expected: { citations: ["policy-refunds"] },
    },
  ],
  variants: { concise: {} },
  expect: ({ output, expected, expect }) => {
    expect(output.citations).toContain(expected.citations[0]);
  },
});
