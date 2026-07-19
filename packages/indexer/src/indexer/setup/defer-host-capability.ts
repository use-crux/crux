import type { CruxHostBinding } from '@use-crux/core'

/** Decide whether effective config retains the detected freezing platform. */
export function configuredHostRetainsPlatform(
  installed: Readonly<Record<string, string>>,
  host: CruxHostBinding | undefined,
): boolean {
  if ('next' in installed) return host?.kind === 'next'
  if ('@use-crux/vercel' in installed || '@vercel/functions' in installed) {
    return host?.kind === 'vercel'
  }
  return false
}
