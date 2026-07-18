import { evaluate } from "@use-crux/core/eval";
import { effectfulToolTask } from "../task";

export default evaluate({
  id: "effectful-tool",
  task: effectfulToolTask,
  cases: [
    { id: "tool-case-a", input: { question: "run" } },
    { id: "tool-case-b", input: { question: "run" } },
  ],
});
