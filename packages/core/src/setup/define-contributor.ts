import type { SetupContributor } from './types.js'

/**
 * Define an immutable project setup contributor.
 *
 * The helper preserves the contributor's concrete type while validating the
 * stable identity used by reports, actions, and tooling registries.
 */
export function defineSetupContributor<
  const TContributor extends SetupContributor,
>(contributor: TContributor): Readonly<TContributor> {
  if (contributor.id.trim().length === 0) {
    throw new TypeError('Setup contributor id must not be empty')
  }

  return Object.freeze(contributor)
}
