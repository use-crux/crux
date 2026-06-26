type JsonPrimitive = string | number | boolean | null
type JsonArray = readonly JsonValue[]
type JsonObject = { readonly [key: string]: JsonValue }
export type JsonValue = JsonPrimitive | JsonArray | JsonObject

export interface CanonicalParityOptions {
  /** Root object kind whose semantic fields should be validated. */
  readonly root: 'indexPatchFacts' | 'staticExtraction'
}

const allowedKeysByPath: Readonly<Record<string, readonly string[]>> = {
  '': [],
  definitions: ['id', 'kind', 'name', 'description', 'tags', 'path', 'source', 'sourceSnippet', 'sourceRefs', 'fidelity', 'status', 'fingerprint', 'metadata', 'quality'],
  relations: ['id', 'type', 'from', 'to', 'fidelity', 'source', 'metadata'],
  sourceRefs: ['definitionId', 'ref'],
  diagnostics: ['id', 'severity', 'code', 'message', 'source', 'relatedDefinitionIds', 'suggestedFix'],
  lintFindings: [
    'id',
    'severity',
    'ruleId',
    'category',
    'maturity',
    'confidence',
    'profiles',
    'title',
    'message',
    'rationale',
    'impact',
    'source',
    'primaryDefinitionId',
    'relatedDefinitionIds',
    'affectedDefinitionIds',
    'evidence',
    'fixes',
    'docsUrl',
    'suppression',
    'suppressed',
    'suppressedBy',
    'propagatedDefinitionIds',
    'propagationPaths',
  ],
  ruleDescriptors: [
    'id',
    'source',
    'extension',
    'severity',
    'category',
    'maturity',
    'confidence',
    'profiles',
    'title',
    'description',
    'rationale',
    'impact',
    'docsUrl',
    'fixes',
    'suppression',
    'phase',
    'requires',
    'fidelity',
    'optionSchema',
    'messageIds',
    'defaultOptions',
    'budget',
  ],
  sources: ['file', 'status', 'shardId', 'definitionIds', 'dependencies', 'dependents', 'diagnostics'],
  prompts: ['id', 'description', 'tags', 'inputSchema', 'outputSchema', 'contextIds', 'hasOutput', 'settings', 'path', 'systemTemplate', 'promptTemplate', 'hasMessages', 'definitionSource'],
  contexts: ['id', 'description', 'priority', 'inputSchema', 'isStatic', 'usedBy', 'path', 'systemTemplate', 'definitionSource'],
  tools: ['name', 'description', 'inputSchema', 'path'],
  sourceGraph: ['schemaVersion', 'producedBy', 'capabilities', 'shards'],
  'sourceGraph.shards': ['id', 'root', 'name', 'packageFile', 'configFile', 'discoveredBy', 'references'],
}

const dynamicJsonPathParts = new Set([
  'metadata',
  'quality',
  'inputSchema',
  'outputSchema',
  'settings',
  'optionSchema',
  'defaultOptions',
  'budget',
])

const unorderedArrayPaths = new Set([
  'definitions',
  'relations',
  'sourceRefs',
  'diagnostics',
  'lintFindings',
  'ruleDescriptors',
  'sources',
  'prompts',
  'contexts',
  'tools',
  'dependencies',
  'sourceGraph.capabilities',
  'sourceGraph.shards',
  'sourceGraph.shards.references',
  'definitions.tags',
  'definitions.path',
  'definitions.sourceRefs',
  'diagnostics.relatedDefinitionIds',
  'lintFindings.profiles',
  'lintFindings.relatedDefinitionIds',
  'lintFindings.affectedDefinitionIds',
  'lintFindings.propagatedDefinitionIds',
  'ruleDescriptors.profiles',
  'ruleDescriptors.requires',
  'ruleDescriptors.messageIds',
  'sources.definitionIds',
  'sources.dependencies',
  'sources.dependents',
  'sources.diagnostics',
])

/**
 * Serializes Project Index parity payloads after conservative normalization.
 *
 * Object keys are sorted, known unordered fact arrays are sorted by stable
 * identity, and path separators are normalized. Unknown semantic fields throw
 * instead of being dropped, so adding a new output field must update the parity
 * contract before the beta gate can pass.
 */
export function canonicalParityJson(value: unknown, options: CanonicalParityOptions): string {
  return JSON.stringify(normalizeParityValue(toJsonValue(value), { path: '', options }))
}

interface NormalizeContext {
  readonly path: string
  readonly options: CanonicalParityOptions
}

function normalizeParityValue(value: JsonValue, context: NormalizeContext): JsonValue {
  if (isJsonArray(value)) {
    const normalized = value.map((item) =>
      normalizeParityValue(item, { ...context, path: normalizeArrayItemPath(context.path) }),
    )
    if (!unorderedArrayPaths.has(context.path)) return normalized
    return [...normalized].sort((left, right) => sortKey(left).localeCompare(sortKey(right)))
  }
  if (!isJsonObject(value)) return normalizePrimitive(value, context.path)

  validateObjectKeys(value, context)
  const sorted: Record<string, JsonValue> = {}
  for (const key of Object.keys(value).sort()) {
    sorted[key] = normalizeParityValue(value[key], { ...context, path: childPath(context.path, key) })
  }
  return sorted
}

function validateObjectKeys(object: JsonObject, context: NormalizeContext): void {
  if (hasDynamicJsonAncestor(context.path)) return
  const allowed = allowedKeys(context)
  if (!allowed) return
  for (const key of Object.keys(object)) {
    if (!allowed.includes(key)) {
      throw new Error(`Unknown parity field at ${context.path || '<root>'}.${key}`)
    }
  }
}

function allowedKeys(context: NormalizeContext): readonly string[] | undefined {
  if (context.path === '') {
    return context.options.root === 'indexPatchFacts'
      ? ['prompts', 'contexts', 'tools', 'lint', 'definitions', 'relations', 'sourceRefs', 'diagnostics', 'lintFindings', 'ruleDescriptors', 'sources', 'sourceGraph']
      : ['definitions', 'relations', 'diagnostics', 'dependencies']
  }
  return allowedKeysByPath[context.path]
}

function normalizePrimitive(value: JsonPrimitive, path: string): JsonPrimitive {
  if (typeof value === 'string' && pathField(path)) return value.replace(/\\/g, '/')
  return value
}

function childPath(parent: string, key: string): string {
  return parent ? `${parent}.${key}` : key
}

function normalizeArrayItemPath(path: string): string {
  return path
}

function hasDynamicJsonAncestor(path: string): boolean {
  return path.split('.').some((part) => dynamicJsonPathParts.has(part))
}

function pathField(path: string): boolean {
  return (
    path === 'sources.file' ||
    path === 'sourceGraph.shards.root' ||
    path === 'sourceGraph.shards.packageFile' ||
    path === 'sourceGraph.shards.configFile' ||
    path === 'sourceGraph.shards.discoveredBy' ||
    path === 'sourceGraph.shards.references' ||
    path === 'sources.dependencies' ||
    path === 'sources.dependents' ||
    path.endsWith('.source.file') ||
    path.endsWith('.range.file') ||
    path.endsWith('.cassettePaths')
  )
}

function sortKey(value: JsonValue): string {
  if (isJsonObject(value)) {
    const sourceRefKey = sourceRefSortKey(value)
    if (sourceRefKey) return sourceRefKey
    for (const key of ['id', 'file', 'name', 'type', 'ruleId']) {
      const item = value[key]
      if (typeof item === 'string') return item
    }
  }
  return JSON.stringify(value)
}

function sourceRefSortKey(value: JsonObject): string | undefined {
  const definitionId = value.definitionId
  if (typeof definitionId !== 'string') return undefined
  const ref = value.ref
  const refId = isJsonObject(ref) ? ref.id : undefined
  return `${definitionId}/${typeof refId === 'string' ? refId : ''}`
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return value !== null && typeof value === 'object' && !isJsonArray(value)
}

function isJsonArray(value: JsonValue): value is JsonArray {
  return Array.isArray(value)
}

function toJsonValue(value: unknown): JsonValue {
  if (value === null) return null
  if (Array.isArray(value)) return value.map(toJsonValue)
  switch (typeof value) {
    case 'string':
    case 'number':
    case 'boolean':
      return value
    case 'object': {
      const object: Record<string, JsonValue> = {}
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        if (child !== undefined) object[key] = toJsonValue(child)
      }
      return object
    }
    default:
      return null
  }
}
