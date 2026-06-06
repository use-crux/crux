import { resolve } from 'node:path'
import type { AbsoluteSourceFilePath } from './types'

/**
 * Normalizes a project root into the path form used by planner decisions.
 */
export function normalizeRoot(root: string): string {
  return resolve(root)
}

/**
 * Normalizes changed file inputs against the project root.
 */
export function normalizeChangedFiles(root: string, files: readonly string[]): AbsoluteSourceFilePath[] {
  return [...new Set(files.map((file) => absoluteSourceFilePath(resolve(root, file))))].sort()
}

/**
 * Brands an already-normalized absolute file path for graph traversal.
 */
export function absoluteSourceFilePath(file: string): AbsoluteSourceFilePath {
  return file as AbsoluteSourceFilePath
}
