import { SafetyConfigError } from '../../../errors'
import type {
  MediaTypePattern,
  MediaGuardrailOptions,
  NormalizedMediaGuardrailConfig,
} from './types'

const MIME_PATTERN = /^[a-z0-9!#$&^_.+-]+\/(?:[a-z0-9!#$&^_.+-]+|\*)$/
const MEDIA_OPTION_FIELDS = ['mediaTypes', 'size', 'sources', 'action'] as const
const MEDIA_TYPE_FIELDS = ['allow', 'allowUnknown'] as const
const SIZE_FIELDS = ['maxBytes', 'allowUnknown'] as const
const SOURCE_FIELDS = [
  'allowHosts',
  'allowInline',
  'allowProviderFiles',
  'allowUrlUserInfo',
  'allowUrlQuery',
] as const

export function normalizeMediaGuardrailConfig(
  options: MediaGuardrailOptions,
): NormalizedMediaGuardrailConfig {
  if (!isRecord(options)) throw configError('at least one rule must be configured.')
  rejectUnknownFields(options, '', MEDIA_OPTION_FIELDS)
  const mediaTypes = options.mediaTypes === undefined
    ? undefined
    : normalizeMediaTypes(options.mediaTypes)
  const size = options.size === undefined ? undefined : normalizeSize(options.size)
  const sources = options.sources === undefined ? undefined : normalizeSources(options.sources)
  if (mediaTypes === undefined && size === undefined && sources === undefined) {
    throw configError('at least one of mediaTypes, size, or sources must be configured.')
  }
  if (
    options.action !== undefined &&
    options.action !== 'block' &&
    options.action !== 'strip'
  ) {
    throw configError('action must be "block" or "strip".')
  }

  return Object.freeze({
    ...(mediaTypes ? { mediaTypes } : {}),
    ...(size ? { size } : {}),
    ...(sources ? { sources } : {}),
    action: options.action ?? 'block',
  })
}

function normalizeSources(value: unknown) {
  if (!isRecord(value)) throw configError('sources must be an object.')
  rejectUnknownFields(value, 'sources.', SOURCE_FIELDS)
  const allowHosts = value.allowHosts === undefined
    ? undefined
    : normalizeHosts(value.allowHosts)
  return Object.freeze({
    ...(allowHosts ? { allowHosts } : {}),
    allowInline: booleanOption(value, 'allowInline', true),
    allowProviderFiles: booleanOption(value, 'allowProviderFiles', true),
    allowUrlUserInfo: booleanOption(value, 'allowUrlUserInfo', false),
    allowUrlQuery: booleanOption(value, 'allowUrlQuery', true),
  })
}

function booleanOption(
  value: Readonly<Record<string, unknown>>,
  field: string,
  defaultValue: boolean,
): boolean {
  const option = value[field]
  if (option === undefined) return defaultValue
  if (typeof option !== 'boolean') throw configError(`sources.${field} must be a boolean.`)
  return option
}

function normalizeHosts(value: unknown): readonly string[] {
  if (!Array.isArray(value)) throw configError('sources.allowHosts must be an array of exact hostnames.')
  return Object.freeze(value.map((entry) => {
    if (typeof entry !== 'string') throw configError('sources.allowHosts entries must be strings.')
    const hostname = entry.trim().toLowerCase()
    if (hostname === '' || hostname.includes('*')) throw invalidHost()
    try {
      const url = new URL(`https://${hostname}`)
      if (
        url.host !== hostname ||
        url.hostname === '' ||
        url.username !== '' ||
        url.password !== '' ||
        url.port !== '' ||
        url.pathname !== '/' ||
        url.search !== '' ||
        url.hash !== ''
      ) {
        throw invalidHost()
      }
      return url.hostname.toLowerCase()
    } catch (error) {
      if (error instanceof SafetyConfigError) throw error
      throw invalidHost()
    }
  }))
}

function invalidHost(): SafetyConfigError {
  return configError('sources.allowHosts entries must be exact hostnames without schemes, ports, paths, or wildcards.')
}

function normalizeMediaTypes(value: unknown) {
  if (!isRecord(value)) {
    throw configError('mediaTypes.allow must be an array of MIME patterns.')
  }
  rejectUnknownFields(value, 'mediaTypes.', MEDIA_TYPE_FIELDS)
  if (!Array.isArray(value.allow)) {
    throw configError('mediaTypes.allow must be an array of MIME patterns.')
  }
  if (value.allowUnknown !== undefined && typeof value.allowUnknown !== 'boolean') {
    throw configError('mediaTypes.allowUnknown must be a boolean.')
  }
  const allow = value.allow.map(normalizePattern)
  if (allow.length === 0) {
    throw configError('mediaTypes.allow must contain at least one MIME pattern.')
  }
  return Object.freeze({
    allow: Object.freeze(allow),
    allowUnknown: value.allowUnknown ?? false,
  })
}

function normalizeSize(value: unknown) {
  if (!isRecord(value)) {
    throw configError('size.maxBytes must be a positive safe integer.')
  }
  rejectUnknownFields(value, 'size.', SIZE_FIELDS)
  if (!Number.isSafeInteger(value.maxBytes) || Number(value.maxBytes) <= 0) {
    throw configError('size.maxBytes must be a positive safe integer.')
  }
  if (value.allowUnknown !== undefined && typeof value.allowUnknown !== 'boolean') {
    throw configError('size.allowUnknown must be a boolean.')
  }
  return Object.freeze({
    maxBytes: Number(value.maxBytes),
    allowUnknown: value.allowUnknown ?? false,
  })
}

function normalizePattern(value: unknown): MediaTypePattern {
  if (typeof value !== 'string') {
    throw configError('mediaTypes.allow entries must be strings.')
  }
  const pattern = value.split(';', 1)[0]?.trim().toLowerCase() ?? ''
  if (!MIME_PATTERN.test(pattern) || pattern === '*/*') {
    throw configError('mediaTypes.allow entries must be MIME essences or top-level wildcards such as "image/*".')
  }
  return pattern as MediaTypePattern
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function rejectUnknownFields(
  value: Readonly<Record<string, unknown>>,
  prefix: string,
  supported: readonly string[],
): void {
  const unknown = Object.keys(value).find((field) => !supported.includes(field))
  if (unknown !== undefined) {
    throw configError(`${prefix}${unknown} is not supported.`)
  }
}

function configError(problem: string): SafetyConfigError {
  return new SafetyConfigError({
    message: `guardrail.media() configuration is invalid: ${problem}`,
  })
}
