import { caseFile, evaluate } from "@use-crux/core/eval";
import { inputSchema, managedTask } from "../managed-task";

export default evaluate({
  task: managedTask,
  timeout: {
    totalMs: 30_000.9,
    stepMs: 5_000,
    firstToken: null,
    toolMs: 10_000,
    tools: { search: 2_500, archive: 4_000 },
  },
  cases: [
    { id: "inherited", input: { question: "hello" } },
    {
      id: "partial",
      input: { question: "hello" },
      timeout: { stepMs: 1_500.9 },
    },
    {
      id: "tool-clear",
      input: { question: "hello" },
      timeout: { tools: { search: null } },
    },
    {
      id: "whole-clear",
      input: { question: "hello" },
      timeout: null,
    },
    caseFile("./fixtures/timeouts.json", { input: inputSchema }),
  ],
});
