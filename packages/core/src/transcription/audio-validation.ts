const AUDIO_TYPES = new Set([
  'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/ogg',
  'audio/flac', 'audio/x-flac', 'audio/webm', 'audio/mp4', 'audio/x-m4a',
])

/** Validate audio MIME and recognizable container bytes without decoding media. */
export function validateAudioBytes(data: Uint8Array, mediaType?: string): string {
  const normalized = mediaType?.split(';', 1)[0]?.trim().toLowerCase()
  const detected = detectAudioMediaType(data)
  if (normalized) assertAudioMediaType(normalized)
  if (!detected) throw new TypeError('Unsupported or invalid audio data')
  if (normalized && !compatibleAudioType(normalized, detected)) throw new TypeError('Audio media type does not match its data')
  return normalized ?? detected
}

/** Validate a known audio MIME without reading or downloading its source. */
export function assertAudioMediaType(mediaType: string): void {
  if (!AUDIO_TYPES.has(mediaType.split(';', 1)[0]!.trim().toLowerCase())) throw new TypeError('Unsupported audio media type')
}

/** Detect supported audio formats from bounded signature bytes. */
export function detectAudioMediaType(data: Uint8Array): string | undefined {
  if (ascii(data, 0, 4) === 'RIFF' && ascii(data, 8, 4) === 'WAVE') return 'audio/wav'
  if (ascii(data, 0, 4) === 'fLaC') return 'audio/flac'
  if (ascii(data, 0, 4) === 'OggS') return 'audio/ogg'
  if (data[0] === 0x1a && data[1] === 0x45 && data[2] === 0xdf && data[3] === 0xa3) return 'audio/webm'
  if (ascii(data, 0, 3) === 'ID3' || (data[0] === 0xff && (data[1]! & 0xe0) === 0xe0)) return 'audio/mpeg'
  if (ascii(data, 4, 4) === 'ftyp') return 'audio/mp4'
  return undefined
}

function compatibleAudioType(declared: string, detected: string): boolean {
  const family = (value: string) => value.replace('audio/x-', 'audio/').replace('audio/mp3', 'audio/mpeg').replace('audio/m4a', 'audio/mp4')
  return family(declared) === family(detected)
}

function ascii(data: Uint8Array, start: number, length: number): string {
  if (data.length < start + length) return ''
  return String.fromCharCode(...data.subarray(start, start + length))
}
