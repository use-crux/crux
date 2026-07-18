import { openSync, readSync, closeSync, statSync } from 'node:fs'
import { basename } from 'node:path'

const CONFIG_NAMES = new Set(['crux.config.ts', 'crux.config.js', 'crux.config.mjs'])
const MAX_AUTHORED_SOURCE_BYTES = 1_000_000
const SAMPLE_BYTES = 128 * 1024

const CRUX_SIGNAL_PATTERNS = [
  /@use-crux\//,
  /\bprompt\s*\(/,
  /\bcontext\s*\(/,
  /\btool\s*\(/,
  /\bagent\s*\(/,
  /\bconvexAgent\s*\(/,
  /\bflow\s*\(/,
  /\bdefer\s*\(/,
  /\bcruxFlow\s*\(/,
  /\bparallel\s*\(/,
  /\bpipeline\s*\(/,
  /\bswarm\s*\(/,
  /\bconsensus\s*\(/,
  /\bmemory\s*\(/,
  /\bworkingState\s*\(/,
  /\bblackboard\s*\(/,
  /\bknowledgeBase\s*\(/,
  /\bretriever\s*\(/,
  /\bretrievalRecipe\s*\(/,
  /\bretrievalStep\s*\(/,
  /\brewriteQuery\s*\(/,
  /\bfanout\s*\(/,
  /\bretrieve\s*\(/,
  /\brerank\s*\(/,
  /\breranker\s*\(/,
  /\bjudgeReranker\s*\(/,
  /\bexpandParents\s*\(/,
  /\bcompressToBudget\s*\(/,
  /\bworkspace\s*\(/,
  /\bconstraint\s*\(/,
  /\bguardrail\s*\(/,
  /\btoolPolicy\s*\(/,
  /\bscorer\s*\(/,
  /\bllmJudge\s*\(/,
  /\bevaluate\s*\(/,
  /\bnew\s+Agent\s*\(/,
]

export type StaticCandidateSkipReason =
  | 'unsupported-extension'
  | 'generated'
  | 'bundled'
  | 'base64-artifact'
  | 'too-large-authored'
  | 'too-large-uninteresting'
  | 'no-crux-signals'
  | 'read-failed'

export type StaticCandidateClassification =
  | { action: 'index'; file: string; bytes: number }
  | { action: 'skip'; file: string; bytes: number; reason: StaticCandidateSkipReason }

export function classifyStaticCandidateFile(
  file: string,
  input: { readonly additionalCallNames?: readonly string[] } = {},
): StaticCandidateClassification {
  if (!isStaticCandidateSourceFile(file)) {
    return { action: 'skip', file, bytes: 0, reason: 'unsupported-extension' }
  }

  let bytes = 0
  let sample = ''
  try {
    const stat = statSync(file)
    bytes = stat.size
    sample = readSample(file, Math.min(bytes, SAMPLE_BYTES))
  } catch {
    return { action: 'skip', file, bytes, reason: 'read-failed' }
  }

  if (isConfigFile(file)) return { action: 'index', file, bytes }

  if (looksBundled(file, sample)) return { action: 'skip', file, bytes, reason: 'bundled' }
  if (looksGenerated(sample)) return { action: 'skip', file, bytes, reason: 'generated' }

  const hasCruxSignals = hasCruxInterest(sample, input.additionalCallNames)
  if (bytes > MAX_AUTHORED_SOURCE_BYTES && hasCruxSignals) {
    return { action: 'skip', file, bytes, reason: 'too-large-authored' }
  }
  if (looksBase64Artifact(file, sample, bytes)) {
    return { action: 'skip', file, bytes, reason: 'base64-artifact' }
  }
  if (bytes > MAX_AUTHORED_SOURCE_BYTES) {
    return { action: 'skip', file, bytes, reason: 'too-large-uninteresting' }
  }
  if (!hasCruxSignals) {
    return { action: 'skip', file, bytes, reason: 'no-crux-signals' }
  }
  return { action: 'index', file, bytes }
}

function readSample(file: string, bytes: number): string {
  if (bytes <= 0) return ''
  const fd = openSync(file, 'r')
  try {
    const buffer = Buffer.allocUnsafe(bytes)
    const read = readSync(fd, buffer, 0, bytes, 0)
    return buffer.subarray(0, read).toString('utf8')
  } finally {
    closeSync(fd)
  }
}

function isConfigFile(file: string): boolean {
  return CONFIG_NAMES.has(basename(file))
}

function isStaticCandidateSourceFile(file: string): boolean {
  if (file.endsWith('.d.ts')) return false
  return isConfigFile(file) || /\.(tsx?|mjs|cjs|jsx?)$/.test(file)
}

function hasCruxInterest(sample: string, additionalCallNames: readonly string[] = []): boolean {
  return (
    CRUX_SIGNAL_PATTERNS.some((pattern) => pattern.test(sample)) ||
    additionalCallNames.some((name) => new RegExp(`\\b${escapeRegExp(name)}\\s*\\(`).test(sample))
  )
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function looksGenerated(sample: string): boolean {
  return /(@generated|auto-generated|automatically generated|do not edit|do not modify)/i.test(sample)
}

function looksBundled(file: string, sample: string): boolean {
  return (
    sample.includes('var __defProp = Object.defineProperty') ||
    sample.includes('var __commonJS =') ||
    sample.includes('__toESM') ||
    sample.includes('node_modules/.pnpm/') ||
    sample.includes('//# sourceMappingURL=') ||
    looksHashedAssetChunk(file, sample)
  )
}

function looksHashedAssetChunk(file: string, sample: string): boolean {
  const normalized = file.replace(/\\/g, '/')
  if (!/\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.(?:[cm]?js|jsx)$/.test(normalized)) {
    return false
  }
  return sample.startsWith('import{') || sample.includes('from"./') || longestLineLength(sample) > 2_000
}

function looksBase64Artifact(file: string, sample: string, bytes: number): boolean {
  if (bytes < 256_000) return false
  const lowerName = basename(file).toLowerCase()
  const artifactName = lowerName.includes('wasm') || lowerName.includes('base64')
  const longestLine = longestLineLength(sample)
  if (artifactName && longestLine > 50_000) return true
  if (longestLine < 100_000) return false
  const compact = sample.replace(/\s+/g, '')
  if (compact.length === 0) return false
  const base64Chars = compact.match(/[A-Za-z0-9+/=]/g)?.length ?? 0
  return base64Chars / compact.length > 0.95
}

function longestLineLength(sample: string): number {
  return sample.split(/\r?\n/).reduce((longest, line) => Math.max(longest, line.length), 0)
}
