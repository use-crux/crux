import { expectTypeOf } from "vitest";
import { z } from "zod";
import { agent, type InferAgentInput } from "../src/agent";
import { prompt } from "../src/prompt";
import type { ToolDef } from "../src/types/tool";

const objectChild = agent({
  id: "object-child",
  description: "Object child",
  prompt: prompt({ input: z.object({ topic: z.string() }), prompt: ({ input }) => input.topic }),
});
const inputlessChild = agent({
  id: "inputless-child",
  description: "Inputless child",
  prompt: prompt({ prompt: () => "ready" }),
});
const scalarChild = agent({
  id: "scalar-child",
  description: "Scalar child",
  prompt: prompt({ input: z.string(), prompt: ({ input }) => input }),
});
const ordinaryTool: ToolDef<{ readonly count: number }> = {
  description: "Ordinary Tool",
  parameters: z.object({ count: z.number() }),
  execute: ({ count }) => count,
};

agent({
  id: "parent",
  prompt: prompt({ prompt: () => "parent" }),
  tools: { objectChild, inputlessChild, scalarChild, ordinaryTool },
});

expectTypeOf<InferAgentInput<typeof objectChild>>().toEqualTypeOf<{ topic: string }>();
expectTypeOf<InferAgentInput<typeof inputlessChild>>().toEqualTypeOf<{}>();
expectTypeOf<InferAgentInput<typeof scalarChild>>().toEqualTypeOf<string>();
