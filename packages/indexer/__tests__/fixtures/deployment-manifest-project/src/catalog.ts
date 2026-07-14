import { prompt } from '@use-crux/core'

/** Representative authored source for deployment-manifest contract fixtures. */
export const catalogFixture = {
  prompt: { id: "writer", name: "Writer" },
  context: { id: "資料", name: "資料" },
};

/** Real authored primitive used by daemon/one-shot CLI parity checks. */
export const writer = prompt({ id: 'writer', system: 'Write clearly.' })
