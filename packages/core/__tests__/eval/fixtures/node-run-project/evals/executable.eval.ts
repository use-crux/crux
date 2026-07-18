import { evaluate } from "../../../../../src/eval";
import { task } from "../task";

export default evaluate({
  id: "executable",
  task,
  cases: [{ id: "executable-case", input: { question: "run" } }],
});
