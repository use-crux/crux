import { evaluate, scorers } from '@use-crux/core/quality'

export default evaluate('evals.judge-missing-binding', {
  task: () => 'This answer would need an LLM judge.',
  data: [{ input: { question: 'Is this helpful?' } }],
  scorers: [scorers.judge({ name: 'helpful', rubric: 'Does the answer resolve the question?' })],
})
