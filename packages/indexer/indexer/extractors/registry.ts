import { createIndexerExtensionRuntime, createStaticExtensionRegistry } from '../extensions'
import { cruxCoreExtension } from './crux-core-extension'

export const indexerExtensions = [cruxCoreExtension] as const

export const indexerExtensionRuntime = createIndexerExtensionRuntime({
  extensions: indexerExtensions,
})

export const indexerExtensionRegistry = createStaticExtensionRegistry(indexerExtensions)

export const staticIndexerCallNames = new Set(indexerExtensionRuntime.manifest.callNames)
