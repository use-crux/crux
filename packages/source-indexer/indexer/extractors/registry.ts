import { createStaticExtensionRegistry, extractWithExtensionRegistry } from '../extensions'
import { cruxCoreExtension } from './crux-core-extension'
import type { StaticCallContext } from './types'

export const sourceIndexerExtensions = [cruxCoreExtension] as const

export const sourceIndexerExtensionRegistry = createStaticExtensionRegistry(sourceIndexerExtensions)

export const staticPrimitiveCallNames = new Set(sourceIndexerExtensionRegistry.callNames)

export function extractWithRegistry(ctx: StaticCallContext) {
  return extractWithExtensionRegistry(sourceIndexerExtensionRegistry, ctx)
}
