import { evaluate } from "../../../../../src/eval";

export default evaluate({
  id: "duplicate",
  task: async (input: { value: string }) => input.value,
  cases: [{ input: { value: "a" } }],
});
