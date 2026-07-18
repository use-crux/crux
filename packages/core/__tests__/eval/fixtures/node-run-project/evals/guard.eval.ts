import { caseFile, evaluate } from "../../../../../src/eval";
import { inputSchema, task } from "../task";

export default evaluate({
  id: "guard",
  task,
  cases: [caseFile("./fixtures/missing.json", { input: inputSchema })],
});
