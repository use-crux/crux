import { evaluate, scorers } from '@use-crux/core/quality'

export default evaluate('evals.embedding-missing-binding', {
  task: () => 'Refunds are available for eligible orders.',
  data: [
    {
      input: { question: 'Can I get a refund?' },
      expected: 'Eligible orders can receive refunds.',
    },
  ],
  scorers: [scorers.embeddingSimilarity()],
})
