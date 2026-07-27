import { evaluate } from "../../../../../src/eval";
import { task } from "../task";
import { quality } from "../scorer";

export default evaluate({
  id: "assessment-edit",
  task,
  cases: [{ id: "assessment-edit-case", input: { question: "run" } }],
  scorers: [quality],
  expect: ({ output, expect }) => expect(output).toContain("run"),
});
