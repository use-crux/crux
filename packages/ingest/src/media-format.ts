import type { IngestFormat } from './types'

export function inferMediaFormat(input: {
  extension?: string
  contentType?: string
  bytes: Uint8Array
}): IngestFormat {
  const extension = input.extension?.toLowerCase().split(/[?#]/, 1)[0] ?? ''
  const contentType = input.contentType?.toLowerCase().split(';', 1)[0] ?? ''
  if (isImageExtension(extension) || isImageType(contentType) || sniffImage(input.bytes)) return 'image'
  if (isVideoExtension(extension) || isVideoType(contentType)) return 'video'
  if (isAudioExtension(extension) || isAudioType(contentType) || sniffAudio(input.bytes)) return 'audio'
  return 'unknown'
}

function isVideoType(value: string): boolean {
  return ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-matroska'].includes(value)
}

function isVideoExtension(value: string): boolean {
  return ['.mp4', '.mov', '.mkv'].some((extension) => value.endsWith(extension))
}

function isAudioType(value: string): boolean {
  return ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/x-m4a',
    'audio/ogg', 'audio/flac', 'audio/x-flac', 'audio/webm'].includes(value)
}

function isAudioExtension(value: string): boolean {
  return ['.mp3', '.wav', '.m4a', '.ogg', '.flac', '.webm'].some((extension) => value.endsWith(extension))
}

function sniffAudio(bytes: Uint8Array): string | undefined {
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WAVE') return 'audio/wav'
  if (ascii(bytes, 0, 4) === 'fLaC') return 'audio/flac'
  if (ascii(bytes, 0, 4) === 'OggS') return 'audio/ogg'
  if (ascii(bytes, 0, 3) === 'ID3' || (bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0)) return 'audio/mpeg'
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'audio/webm'
  if (ascii(bytes, 4, 4) === 'ftyp' && ['M4A ', 'M4B '].includes(ascii(bytes, 8, 4))) return 'audio/mp4'
  return undefined
}

export function imageMediaType(input: { extension?: string; contentType?: string; bytes: Uint8Array }): string | undefined {
  const contentType = input.contentType?.toLowerCase().split(';', 1)[0]
  if (contentType && isImageType(contentType)) return contentType === 'image/jpg' ? 'image/jpeg' : contentType
  return sniffImage(input.bytes) ?? extensionImageType(input.extension ?? '')
}

function isImageType(value: string): boolean {
  return value === 'image/png' || value === 'image/jpeg' || value === 'image/jpg' ||
    value === 'image/webp' || value === 'image/gif'
}

function isImageExtension(value: string): boolean {
  return ['.png', '.jpg', '.jpeg', '.webp', '.gif'].some((extension) => value.endsWith(extension))
}

function extensionImageType(value: string): string | undefined {
  const lower = value.toLowerCase().split(/[?#]/, 1)[0] ?? ''
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.gif')) return 'image/gif'
  return undefined
}

function sniffImage(bytes: Uint8Array): string | undefined {
  if (starts(bytes, [0x89, 0x50, 0x4e, 0x47])) return 'image/png'
  if (starts(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (starts(bytes, [0x47, 0x49, 0x46, 0x38])) return 'image/gif'
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'image/webp'
  return undefined
}

function starts(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return prefix.every((byte, index) => bytes[index] === byte)
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  if (bytes.length < start + length) return ''
  return String.fromCharCode(...bytes.subarray(start, start + length))
}
