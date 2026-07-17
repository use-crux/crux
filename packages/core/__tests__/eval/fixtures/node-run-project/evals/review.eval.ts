import { evaluate } from "../../../../../src/eval";
import { task } from "../task";

export default evaluate({
  id: "review",
  task,
  cases: [{ id: "existing", input: { question: "existing" }, skip: true }],
});
