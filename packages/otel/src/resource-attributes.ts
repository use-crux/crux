/**
 * Portable mapping from Crux deployment identity to OTel Resource attributes.
 *
 * This module deliberately returns plain data. Applications own their OTel
 * SDK/provider and add these attributes while constructing its immutable
 * Resource, before registering or starting the provider.
 *
 * @module
 */

import {
  CruxDeploymentIdentitySchema,
  type CruxDeploymentIdentity,
} from '@use-crux/core/project-index'

/** Exact Crux semantic attributes added to an application-owned OTel Resource. */
export interface CruxOtelResourceAttributes {
  readonly 'crux.project.id': string
  readonly 'crux.manifest.id'?: string
  readonly 'crux.deployment.id'?: string
}

/**
 * Validate deployment identity and map it to OTel Resource attributes.
 *
 * Optional values are omitted rather than emitted as empty placeholders. The
 * returned object has no dependency on an OTel SDK and is safe to import from
 * portable runtime graphs.
 *
 * @param identity - The same identity passed to `observability.identity`.
 * @returns Plain attributes to merge into the application's OTel Resource.
 * @throws {ZodError} When identity violates the shared Crux contract.
 */
export function createCruxResourceAttributes(
  identity: CruxDeploymentIdentity,
): CruxOtelResourceAttributes {
  const parsed = CruxDeploymentIdentitySchema.parse(identity)
  return {
    'crux.project.id': parsed.projectId,
    ...(parsed.manifestId ? { 'crux.manifest.id': parsed.manifestId } : {}),
    ...(parsed.deploymentId
      ? { 'crux.deployment.id': parsed.deploymentId }
      : {}),
  }
}
