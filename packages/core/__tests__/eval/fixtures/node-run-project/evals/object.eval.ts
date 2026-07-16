import { evaluate } from "../../../../../src/eval";
import { task } from "../task";

export default evaluate({
  id: "object",
  task,
  cases: [{ id: "object-case", input: { question: "object" }, skip: true }],
});
