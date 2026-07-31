import { expect, it } from "vitest";
import { z } from "zod";
import {
  agent,
  createFakeAgentExecutor,
  createPipeline,
} from "../src/agent";
import { prompt } from "../src";

const child = agent({
  id: "writer",
  prompt: prompt({
    id: "nested-receipt-writer",
    input: z.object({ seed: z.number() }),
    prompt: "write",
  }),
});

it("skips nested wrappers and preserves their receipt-tree boundary", async () => {
  const executor = createFakeAgentExecutor({ fallback: "echo" });
  const pipeline = createPipeline(executor);
  let outerCalls = 0;
  let innerCalls = 0;

  const result = await pipeline({
    id: "outer-pipeline",
    context: { seed: 1 },
    steps: [
      {
        name: "nested",
        fn: () =>
          pipeline({
            id: "inner-pipeline",
            context: { seed: 1 },
            steps: [{ name: "write", agent: child }],
            prepareInvocation() {
              innerCalls += 1;
            },
          }),
      },
    ],
    prepareInvocation() {
      outerCalls += 1;
    },
  });

  expect(outerCalls).toBe(0);
  expect(innerCalls).toBe(1);
  expect(result.requestReceipts.children[0]).toMatchObject({
    kind: "composition",
    label: "nested",
    tree: {
      composition: { id: "inner-pipeline", kind: "pipeline" },
      children: [
        {
          kind: "invocation",
          target: { id: "writer", operation: "language" },
        },
      ],
    },
  });
});
