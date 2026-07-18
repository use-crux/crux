import { evaluate } from "../../../../../src/eval";

export default evaluate({
  id: "opaque",
  task: async (input: { question: string }) => input.question.toUpperCase(),
  cases: [{ id: "opaque-case", input: { question: "works" } }],
});
