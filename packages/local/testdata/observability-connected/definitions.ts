import { prompt } from '@use-crux/core'

/** Canonical authored definition used by the built-binary observability fixture. */
export const connectedPrompt = prompt({
  id: 'fixture.connected-prompt',
  system: 'Answer fixture requests concisely.',
})
