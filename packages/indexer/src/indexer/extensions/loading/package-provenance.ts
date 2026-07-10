/**
 * Package provenance checks for dynamic Indexer extension loading.
 *
 * This module resolves configured package specifiers from the project root,
 * verifies the owning package identity, applies the configured trust policy to
 * the real package name, and checks that the resolved entry stays inside the
 * owning package before loader code imports it.
 *
 * @module
 */

import { readFile, realpath } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import type { ExtensionReference, ExtensionTrustPolicy } from '../public-contract/types'

/** Resolved package entry that passed provenance and trust preflight. */
export interface TrustedExtensionPackage {
  /** Absolute file resolved by Node's package resolver. */
  readonly entry: string
  /** Real package name from the owning package.json. */
  readonly packageName: string
  /** Installed package version from package.json, when declared. */
  readonly packageVersion?: string
}

/** Result of extension package provenance preflight. */
export type TrustedExtensionPackageResult =
  | { readonly ok: true; readonly package: TrustedExtensionPackage }
  | { readonly ok: false; readonly message: string }

/** Resolve and verify one configured extension package before import. */
export async function resolveTrustedExtensionPackage(input: {
  readonly root: string
  readonly reference: ExtensionReference
  readonly policy: ExtensionTrustPolicy | undefined
}): Promise<TrustedExtensionPackageResult> {
  const requireFromProject = createRequire(join(input.root, 'package.json'))
  const entry = requireFromProject.resolve(input.reference.package)
  const packageRoot = await nearestPackageRoot(entry)
  if (!packageRoot) {
    return {
      ok: false,
      message: `Indexer extension ${formatReference(input.reference)} could not be associated with a package manifest.`,
    }
  }

  const manifest = await readPackageManifest(packageRoot)
  const packageName = typeof manifest.name === 'string' ? manifest.name : undefined
  const declaredPackage = packageIdentityFromSpecifier(input.reference.package)
  if (packageName !== declaredPackage) {
    return {
      ok: false,
      message: `Indexer extension ${formatReference(input.reference)} resolved to package ${
        packageName ?? '<unknown>'
      }, not ${declaredPackage}.`,
    }
  }

  if (!isPackageReferenceAllowed(packageName, input.policy)) {
    return {
      ok: false,
      message: `Indexer extension package ${packageName} is not allowed by the active trust policy.`,
    }
  }

  const realPackageRoot = await realPathOrSelf(packageRoot)
  const realEntry = await realPathOrSelf(entry)
  if (!isInsideRoot(realPackageRoot, realEntry)) {
    return {
      ok: false,
      message: `Indexer extension ${formatReference(input.reference)} resolved outside package ${packageName}.`,
    }
  }

  return {
    ok: true,
    package: {
      entry,
      packageName,
      ...(typeof manifest.version === 'string' ? { packageVersion: manifest.version } : {}),
    },
  }
}

/** Applies a configured trust policy to one package identity. */
export function isPackageReferenceAllowed(packageName: string, policy: ExtensionTrustPolicy | undefined): boolean {
  const effective = policy ?? { mode: 'first-party-only' }
  if (effective.deny?.includes(packageName)) return false
  if (effective.mode === 'unsafe-local-dev') return true
  if (effective.mode === 'allowlisted') return effective.allow?.includes(packageName) ?? false
  return packageName === '@use-crux/indexer' || packageName.startsWith('@use-crux/')
}

/** Return whether a package specifier attempts path traversal. */
export function hasTraversalSegment(specifier: string): boolean {
  return specifier.split(/[\\/]+/).includes('..')
}

async function nearestPackageRoot(entry: string): Promise<string | undefined> {
  let current = dirname(entry)
  while (true) {
    try {
      await readFile(join(current, 'package.json'), 'utf8')
      return current
    } catch {
      const parent = dirname(current)
      if (parent === current) return undefined
      current = parent
    }
  }
}

async function readPackageManifest(packageRoot: string): Promise<{ readonly name?: unknown; readonly version?: unknown }> {
  try {
    const parsed = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')) as unknown
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function packageIdentityFromSpecifier(specifier: string): string {
  const parts = specifier.split('/')
  if (parts[0]?.startsWith('@')) return parts.slice(0, 2).join('/')
  return parts[0] ?? specifier
}

function isInsideRoot(root: string, candidate: string): boolean {
  const child = relative(resolve(root), resolve(candidate))
  return child === '' || (!child.startsWith('..') && !isAbsolute(child))
}

async function realPathOrSelf(path: string): Promise<string> {
  try {
    return await realpath(path)
  } catch {
    return path
  }
}

function formatReference(reference: ExtensionReference): string {
  return `${reference.package}#${reference.export ?? 'default'}`
}
