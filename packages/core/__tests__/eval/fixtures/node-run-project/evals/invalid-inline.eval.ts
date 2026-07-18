import { evaluate } from "../../../../../src/eval";
import { task } from "../task";

export default evaluate({
  id: "invalid-inline",
  task,
  cases: [{ id: "invalid", input: { question: 42 } as never }],
});
