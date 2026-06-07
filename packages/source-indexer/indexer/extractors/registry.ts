import { createSourceIndexerExtensionRuntime, createStaticExtensionRegistry } from '../extensions'
import { cruxCoreExtension } from './crux-core-extension'

export const sourceIndexerExtensions = [cruxCoreExtension] as const

export const sourceIndexerExtensionRuntime = createSourceIndexerExtensionRuntime({
  extensions: sourceIndexerExtensions,
})

export const sourceIndexerExtensionRegistry = createStaticExtensionRegistry(sourceIndexerExtensions)

export const staticPrimitiveCallNames = new Set(sourceIndexerExtensionRuntime.manifest.callNames)
