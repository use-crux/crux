import { context, createContexts } from '@use-crux/core'

export const supportPolicy = context({
  id: 'support.policy',
  system: 'Answer with the public support policy.',
})

export const contexts = createContexts({
  support: {
    policy: supportPolicy,
  },
})
