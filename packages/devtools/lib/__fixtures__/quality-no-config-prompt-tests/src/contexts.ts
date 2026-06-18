import { context, createContexts } from '@crux/core'

export const supportPolicy = context({
  id: 'support.policy',
  system: 'Answer with the public support policy.',
})

export const contexts = createContexts({
  support: {
    policy: supportPolicy,
  },
})
