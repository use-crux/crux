import { z } from 'zod'
import { context, contributor, prefer } from '../src'

const contributorInput = z.object({ accountId: z.string() })

const contributorSource = contributor({
  id: 'typed-representation-contributor',
  input: contributorInput,
  contribute: () => ({}),
})

const matchingAlternative = context({
  id: 'typed-representation-alternative',
  input: contributorInput,
  system: 'Compact account guidance.',
})

const wrongAlternative = context({
  id: 'wrong-representation-alternative',
  input: z.object({ accountId: z.number() }),
  system: 'Wrong account guidance.',
})

prefer(contributorSource, matchingAlternative)

// @ts-expect-error Contributor-backed sources keep their authored input schema for alternatives.
prefer(contributorSource, wrongAlternative)
