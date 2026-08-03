import { z } from 'zod'
import { context } from '../src/prompt/context'
import type { ContextDef } from '../src/prompt/context-types'
import { prompt } from '../src/prompt/prompt'

const profileContextInput = z.object({
  profile: z.object({
    bio: z.string(),
  }),
})

const profileContext = context({
  input: profileContextInput,
  escapeFields: ['profile'],
  system: ({ input }) => input.profile.bio,
})

const invalidContextEscapeFields = {
  input: profileContextInput,
  // @ts-expect-error escapeFields is typed to this context's schema keys.
  escapeFields: ['missing'],
  system: 'profile',
} satisfies ContextDef<typeof profileContextInput>

void invalidContextEscapeFields

prompt({
  use: [profileContext],
  input: z.object({
    query: z.string(),
  }),
  escapeFields: ['query', 'profile'],
  system: ({ input }) => `${input.query}:${input.profile.bio}`,
})

prompt({
  use: [profileContext],
  input: z.object({ query: z.string() }),
  // @ts-expect-error escapeFields is typed to the prompt's merged schema keys.
  escapeFields: ['missing'],
  system: ({ input }) => `${input.query}:${input.profile.bio}`,
})
