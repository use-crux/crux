import { caseFile, evaluate } from "../../../../../src/eval";
import { inputSchema, task } from "../task";

export default evaluate({
  task,
  cases: [caseFile("./fixtures/support.json", { input: inputSchema })],
});
