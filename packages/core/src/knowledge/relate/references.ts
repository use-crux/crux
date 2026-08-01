/**
 * Built-in explicit reference relation stage.
 *
 * Scan chunk text for citations and emit unresolved document locators for
 * graph compilation.
 *
 * @module
 */

import { relate, type RelationStage } from './relate'

const referenceTypes = {
  references: {
    from: ['chunk'],
    to: ['document'],
    direction: 'directed',
    description: 'A chunk explicitly references another document',
  },
} as const

/** Configuration for {@link relateReferences}. */
export interface RelateReferencesConfig {
  /** Stable stage id within an indexing pipeline. */
  readonly id?: string
}

/**
 * Create the built-in explicit-reference relation stage.
 *
 * @param config - Optional stage identity override.
 * @returns A deterministic relation stage that emits `references` claims.
 *
 * @example
 * ```ts
 * const pipeline = indexingPipeline({
 *   derive: [relateReferences()],
 * })
 * ```
 */
export function relateReferences(config: RelateReferencesConfig = {}): RelationStage<typeof referenceTypes> {
  return relate({
    id: config.id ?? 'references',
    version: 1,
    types: referenceTypes,
    run: (input, api) => {
      for (const chunk of input.chunks) {
        const evidence = {
          kind: 'chunk',
          sourceId: chunk.sourceId,
          chunkId: chunk.chunkId,
        } as const
        for (const target of extractReferences(chunk.content)) {
          api.emit('references', evidence, target, { evidence, provenance: 'exact' })
        }
      }
    },
  })
}

type ReferenceTarget = { readonly url: string } | { readonly title: string }

function extractReferences(content: string): readonly ReferenceTarget[] {
  const found = new Map<string, ReferenceTarget>()
  for (const url of markdownLinkUrls(content)) add(found, { url })
  for (const url of bareUrls(content)) add(found, { url })
  for (const title of citedTitles(content)) add(found, { title })
  return [...found.values()].sort(compareTargets)
}

function markdownLinkUrls(content: string): readonly string[] {
  const urls: string[] = []
  const pattern = /\[[^\]\n]{1,300}\]\((https?:\/\/[^\s)<>]+)\)/g
  for (const match of content.matchAll(pattern)) {
    const url = cleanUrl(match[1] ?? '')
    if (url) urls.push(url)
  }
  return urls
}

function bareUrls(content: string): readonly string[] {
  const urls: string[] = []
  const pattern = /https?:\/\/[^\s<>()\]]+/g
  for (const match of content.matchAll(pattern)) {
    const url = cleanUrl(match[0] ?? '')
    if (url) urls.push(url)
  }
  return urls
}

function citedTitles(content: string): readonly string[] {
  return unique([
    ...quotedTitles(content),
    ...bracketedTitles(content),
  ])
}

function quotedTitles(content: string): readonly string[] {
  const titles: string[] = []
  const pattern = /(["'`])([^"'`\n]{1,200})\1\s*(?:\[\^?[A-Za-z0-9_.-]+\]|\([A-Za-z0-9_. -]{1,80}\))/g
  for (const match of content.matchAll(pattern)) {
    const title = cleanTitle(match[2] ?? '')
    if (title) titles.push(title)
  }
  return titles
}

function bracketedTitles(content: string): readonly string[] {
  const titles: string[] = []
  const pattern = /\[([^\]\n]{1,200})\]\s*(?:\[\^?[A-Za-z0-9_.-]+\]|\([A-Za-z0-9_. -]{1,80}\))/g
  for (const match of content.matchAll(pattern)) {
    const title = cleanTitle(match[1] ?? '')
    if (title && !looksLikeCitationMarker(title)) titles.push(title)
  }
  return titles
}

function add(targets: Map<string, ReferenceTarget>, target: ReferenceTarget): void {
  const key = 'url' in target ? `url:${target.url}` : `title:${target.title}`
  targets.set(key, target)
}

function cleanUrl(value: string): string {
  return value.trim().replace(/[.,;:!?]+$/g, '')
}

function cleanTitle(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function looksLikeCitationMarker(value: string): boolean {
  return /^\^?[A-Za-z0-9_.-]+$/.test(value.trim())
}

function compareTargets(left: ReferenceTarget, right: ReferenceTarget): number {
  return targetKey(left).localeCompare(targetKey(right))
}

function targetKey(target: ReferenceTarget): string {
  return 'url' in target ? `url:${target.url}` : `title:${target.title}`
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)]
}
