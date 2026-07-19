import type { DataAsset } from '../asset/types'
import { validateOperationExecution, validateOperationTimeout } from '../completed-operation/contracts'
import type { CompletedOperationPayload, OperationTimeout } from '../completed-operation/contracts'
import type { GenerateSpeechPayload } from './contracts'

/** Validate portable speech controls before provider I/O. */
export function validateGenerateSpeechOptions(options: Readonly<{
  text: string
  outputFormat?: string
  instructions?: string
  speed?: number
  language?: string
  timeout?: OperationTimeout
}>): void {
  requiredText(options.text, 'text')
  optionalText(options.outputFormat, 'outputFormat')
  optionalText(options.instructions, 'instructions')
  optionalText(options.language, 'language')
  if (options.speed !== undefined && (!Number.isFinite(options.speed) || options.speed <= 0)) {
    throw new RangeError('Speech speed must be a positive finite number.')
  }
  validateOperationTimeout(options.timeout)
}

/**
 * Validate one successful native audio asset and construct an ID-free payload.
 * The shared media runner owns the eventual public operation metadata.
 */
export function createGenerateSpeechResult<TRaw, TMetadata = unknown, TWarning = unknown>(
  audio: DataAsset,
  result: CompletedOperationPayload<TRaw, TMetadata, TWarning>,
): GenerateSpeechPayload<TRaw, TMetadata, TWarning> {
  if (!/^audio\/[a-z0-9.+-]+$/i.test(audio.mediaType)) throw new TypeError('Speech audio must use an audio MIME type.')
  if (audio.data instanceof Uint8Array && audio.data.byteLength === 0) throw new TypeError('Speech audio bytes must not be empty.')
  if (audio.data instanceof Blob && audio.data.size === 0) throw new TypeError('Speech audio blob must not be empty.')
  return Object.freeze({
    audio,
    warnings: Object.freeze([...result.warnings]),
    execution: validateOperationExecution(result.execution),
    ...(result.providerMetadata === undefined ? {} : { providerMetadata: result.providerMetadata }),
    raw: result.raw,
  })
}

function requiredText(value: string, name: string): void {
  if (!value.trim()) throw new TypeError(`Speech ${name} must be non-empty.`)
}

function optionalText(value: string | undefined, name: string): void {
  if (value !== undefined) requiredText(value, name)
}
