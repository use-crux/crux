import { createStaticExtensionRegistry } from '../extensions'
import { cruxCoreExtension } from './crux-core-extension'

export const sourceIndexerExtensions = [cruxCoreExtension] as const

export const sourceIndexerExtensionRegistry = createStaticExtensionRegistry(sourceIndexerExtensions)

export const staticPrimitiveCallNames = new Set(sourceIndexerExtensionRegistry.callNames)
