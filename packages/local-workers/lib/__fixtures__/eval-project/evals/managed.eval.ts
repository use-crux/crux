import { caseFile, evaluate } from "@use-crux/core/eval";
import { inputSchema, managedTask } from "../managed-task";

export default evaluate({
  task: managedTask,
  cases: [
    { id: "hello", input: { question: "hello" } },
    caseFile("./fixtures/managed.json", { input: inputSchema }),
  ],
  expect: ({ output, expect: assert }) => assert(output).toBe("hello"),
});
