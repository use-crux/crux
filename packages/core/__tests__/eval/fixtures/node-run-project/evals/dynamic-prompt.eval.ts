import { evaluate } from "../../../../../src/eval";
import { task } from "../task";

export const loadPrompt = (name: string) => {
  const specifier = `../prompts/${name}.ts`;
  return import(/* @vite-ignore */ specifier);
};

export default evaluate({
  id: "dynamic-prompt",
  task,
  cases: [{ id: "dynamic-prompt-case", input: { question: "run" } }],
});
