/**
 * Pure Runtime Engine namespace resolution.
 *
 * @module
 */

import type { RuntimeNamespaceSource } from '../api/runtime-definition'
import { createRuntimeError } from '../engine/errors'

export type { RuntimeNamespaceSource } from '../api/runtime-definition'

/** Environment values used by Runtime Engine namespace resolution. */
export interface RuntimeNamespaceEnvironment {
  readonly NODE_ENV?: string
  readonly CRUX_RUNTIME_NAMESPACE?: string
  readonly VERCEL_ENV?: string
  readonly VERCEL_GIT_COMMIT_REF?: string
}

/** Readonly namespace selected by the Runtime Engine resolution ladder. */
export interface RuntimeNamespaceResolution {
  readonly namespace: string
  readonly source: RuntimeNamespaceSource
}

/** Resolve a Runtime Engine namespace without reading process environment. */
export function resolveRuntimeNamespace(options: {
  readonly namespace?: string
  readonly env: RuntimeNamespaceEnvironment
}): RuntimeNamespaceResolution {
  const explicit = nonEmpty(options.namespace)
  if (explicit !== undefined) return resolved(explicit, 'explicit')

  const configured = nonEmpty(options.env.CRUX_RUNTIME_NAMESPACE)
  if (configured !== undefined) return resolved(configured, 'env')

  if (options.env.VERCEL_ENV === 'production') {
    return resolved('production', 'inferred')
  }

  if (options.env.VERCEL_ENV === 'preview') {
    const ref = sanitizePreviewRef(options.env.VERCEL_GIT_COMMIT_REF ?? '')
    if (ref !== '') return resolved(`preview-${ref}`, 'inferred')
  }

  if (options.env.NODE_ENV !== 'production') {
    return resolved('local', 'fallback')
  }

  throw createRuntimeError({
    code: 'NAMESPACE_AMBIGUOUS',
    whatFailed:
      'serverless() could not resolve a safe Runtime Engine namespace.',
    why: 'Production durable state needs an explicit partition and no supported Vercel deployment signal was available.',
    whatStillWorks:
      'Local development can use the local namespace, and explicitly configured serverless runtimes continue to work.',
    nextStep:
      'Set CRUX_RUNTIME_NAMESPACE=production or pass serverless({ namespace: "..." }).',
  })
}

function resolved(
  namespace: string,
  source: RuntimeNamespaceSource,
): RuntimeNamespaceResolution {
  return Object.freeze({ namespace, source })
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed === '' ? undefined : trimmed
}

function sanitizePreviewRef(ref: string): string {
  return ref
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, 64)
    .replace(/-+$/, '')
}
