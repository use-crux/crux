import { evaluate } from "@use-crux/core/eval";
import { pureTask } from "../task";

export default evaluate({
  id: "pure-identity",
  task: pureTask,
  cases: [{ id: "pure-case", input: { question: "run" } }],
  expect: ({ output, expect }) => expect(output).toBe("run"),
});
