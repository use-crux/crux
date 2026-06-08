import { createExtensionRegistry } from './indexer/extensions'
import type { IndexerExtension } from './extensions'

export interface IndexerExtensionFixture {
  readonly extension: IndexerExtension
}

export function defineIndexerExtensionFixture(extension: IndexerExtension): IndexerExtensionFixture {
  return { extension }
}

export function validateIndexerExtensionFixture(fixture: IndexerExtensionFixture): void {
  createExtensionRegistry([fixture.extension])
}
