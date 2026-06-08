/**
 * Project boundary files whose changes can alter index discovery, module resolution, or workspace
 * membership.
 */
export const indexBoundaryFileNames = [
  '.gitmodules',
  'crux.config.mts',
  'crux.config.ts',
  'jsconfig.json',
  'package-lock.json',
  'package.json',
  'pnpm-lock.yaml',
  'tsconfig.json',
  'yarn.lock',
] as const

/**
 * Boundary files that must participate in static or semantic cache fingerprints.
 */
export const indexCacheBoundaryFileNames = ['jsconfig.json', 'tsconfig.json'] as const
