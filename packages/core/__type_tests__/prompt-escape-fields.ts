import { z } from 'zod'
import { context } from '../src/prompt/context'
import { prompt } from '../src/prompt/prompt'

const profileContext = context({
  input: z.object({
    profile: z.object({
      bio: z.string(),
    }),
  }),
  escapeFields: ['profile'],
  system: ({ input }) => input.profile.bio,
})

context({
  input: z.object({ profile: z.object({ bio: z.string() }) }),
  // @ts-expect-error escapeFields is typed to this context's schema keys.
  escapeFields: ['missing'],
  system: ({ input }) => input.profile.bio,
})

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
