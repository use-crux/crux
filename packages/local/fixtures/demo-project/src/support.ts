import { context, prompt, tool } from "@use-crux/core";
import { z } from "zod";

/** Grounding policy used by the support answer prompt. */
export const refundPolicy = context({
  id: "demo.refund-policy",
  description: "Authoritative refund eligibility and timing.",
  system: "Monthly plans are refundable within 14 days of purchase.",
});

/** Escalation policy for exceptions outside the standard refund window. */
export const escalationPolicy = context({
  id: "demo.escalation-policy",
  description: "Approval requirements for exceptional refunds.",
  system: "Refund exceptions require a support manager approval.",
});

/** Citation policy used when support evidence is incomplete. */
export const citationPolicy = context({
  id: "demo.citation-policy",
  description: "Grounding requirements for customer-facing answers.",
  system: "Do not state a policy claim unless its policy id is cited.",
});

/** Demo lookup tool represented in both Project Index and seeded traces. */
export const searchPolicies = tool({
  name: "searchPolicies",
  description: "Search the current support policy catalog.",
  input: z.object({ query: z.string() }),
  execute: async ({ query }) => ({
    query,
    policies: ["policy-refunds"],
  }),
});

/** Flagship support prompt with explicit context and a bounded tool surface. */
export const supportPrompt = prompt({
  id: "demo.support",
  input: z.object({ question: z.string() }),
  output: z.object({
    answer: z.string(),
    citations: z.array(z.string()),
  }),
  use: [refundPolicy],
  tools: { searchPolicies },
  system: "Answer from retrieved policy evidence and cite every policy claim.",
  prompt: ({ input }) => input.question,
});

/** Opaque production-shaped task used by the authored Eval fixture. */
export async function supportTask(input: { question: string }) {
  return {
    answer: `Review required: ${input.question}`,
    citations: ["policy-refunds"],
  };
}
