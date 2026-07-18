import { evaluate } from "../../../../../src/eval";
import { replacementTask } from "../replacement-task";
import { task } from "../task";

export default evaluate({
  id: "replacement",
  task,
  cases: [{ id: "replacement-case", input: { question: "run" } }],
  variants: { replacement: { task: replacementTask } },
});
