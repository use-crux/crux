import { evaluate } from "@use-crux/core/eval";
import { effectfulContextTask } from "../task";

export default evaluate({
  id: "effectful-context",
  task: effectfulContextTask,
  cases: [
    { id: "context-case-a", input: { question: "run" } },
    { id: "context-case-b", input: { question: "run" } },
  ],
});
