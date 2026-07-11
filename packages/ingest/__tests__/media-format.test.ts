import { describe, expect, it } from 'vitest'
import { inferMediaFormat } from '../src/media-format'

describe('audio format detection', () => {
  it.each(['mp3', 'wav', 'm4a', 'ogg', 'flac', 'webm'])('detects .%s sources', (extension) => {
    expect(inferMediaFormat({ extension: `audio.${extension}`, bytes: new Uint8Array() })).toBe('audio')
  })

  it.each(['audio/mpeg', 'audio/wav', 'audio/mp4', 'audio/ogg', 'audio/flac', 'audio/webm'])(
    'detects %s responses',
    (contentType) => expect(inferMediaFormat({ contentType, bytes: new Uint8Array() })).toBe('audio'),
  )

  it('detects reliable magic but does not claim generic MP4 containers', () => {
    expect(inferMediaFormat({ bytes: bytes('RIFF\0\0\0\0WAVE') })).toBe('audio')
    expect(inferMediaFormat({ bytes: bytes('\0\0\0\0ftypM4A ') })).toBe('audio')
    expect(inferMediaFormat({ bytes: bytes('\0\0\0\0ftypisom') })).toBe('unknown')
  })
})

function bytes(value: string): Uint8Array {
  return Uint8Array.from(value, (character) => character.charCodeAt(0))
}
