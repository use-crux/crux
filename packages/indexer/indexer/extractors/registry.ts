import { createIndexerExtensionRuntime, createStaticExtensionRegistry } from '../extensions'
import { cruxCoreExtension } from './crux-core-extension'

export const sourceIndexerExtensions = [cruxCoreExtension] as const

export const indexerExtensionRuntime = createIndexerExtensionRuntime({
  extensions: sourceIndexerExtensions,
})

export const sourceIndexerExtensionRegistry = createStaticExtensionRegistry(sourceIndexerExtensions)

export const staticPrimitiveCallNames = new Set(indexerExtensionRuntime.manifest.callNames)
