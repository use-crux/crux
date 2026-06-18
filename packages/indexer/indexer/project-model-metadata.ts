/**
 * Project Model metadata projection helpers.
 *
 * The Project Model is a compact inspect surface rather than a full Project
 * Index snapshot. This module keeps the selected metadata mapping explicit so
 * new definition kinds can expose useful facts without turning the resolver
 * into a catch-all metadata copier.
 *
 * @module
 */

import type { ProjectDefinition } from '@crux/core/project-index'

/** Builds JSON-safe metadata for one Project Model definition. */
export function projectModelDefinitionMetadata(definition: ProjectDefinition): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    fidelity: definition.fidelity,
    ...(definition.status ? { status: definition.status } : {}),
    ...(definition.description ? { description: definition.description } : {}),
    ...(definition.tags ? { tags: definition.tags } : {}),
  }

  if (definition.kind === 'registry') {
    return {
      ...metadata,
      ...registryMetadata(definition.metadata),
    }
  }

  if (definition.kind === 'skill') {
    return {
      ...metadata,
      ...skillMetadata(definition.metadata),
    }
  }

  return metadata
}

function skillMetadata(metadata: ProjectDefinition['metadata']): Record<string, unknown> {
  const loader = metadata?.loader === 'registry' ? 'registry' : undefined
  const identifier = typeof metadata?.identifier === 'string' ? metadata.identifier : undefined
  const registryName = typeof metadata?.registryName === 'string' ? metadata.registryName : undefined
  const registryPath = typeof metadata?.registryPath === 'string' ? metadata.registryPath : undefined
  const registryVariable = typeof metadata?.registryVariable === 'string' ? metadata.registryVariable : undefined
  const facts = isRecord(metadata?.facts) ? metadata.facts : undefined
  return {
    ...(loader ? { loader } : {}),
    ...(identifier ? { identifier } : {}),
    ...(registryName ? { registryName } : {}),
    ...(registryPath ? { registryPath } : {}),
    ...(registryVariable ? { registryVariable } : {}),
    ...(facts ? { facts } : {}),
  }
}

function registryMetadata(metadata: ProjectDefinition['metadata']): Record<string, unknown> {
  const baseUrl = typeof metadata?.baseUrl === 'string' ? metadata.baseUrl : undefined
  const hasAuth = typeof metadata?.hasAuth === 'boolean' ? metadata.hasAuth : undefined
  const bundled = typeof metadata?.bundled === 'boolean' ? metadata.bundled : undefined
  const facts = isRecord(metadata?.facts) ? metadata.facts : undefined
  return {
    ...(baseUrl ? { baseUrl } : {}),
    ...(hasAuth !== undefined ? { hasAuth } : {}),
    ...(bundled !== undefined ? { bundled } : {}),
    ...(facts ? { facts } : {}),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
