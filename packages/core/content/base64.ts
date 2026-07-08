const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const BASE64_LOOKUP = new Map<string, number>(
  [...BASE64_ALPHABET].map((char, index) => [char, index] as const),
)

BASE64_LOOKUP.set('-', 62)
BASE64_LOOKUP.set('_', 63)

/** Encode bytes as standard base64 without relying on host-specific globals. */
export function bytesToBase64(bytes: Uint8Array): string {
  let output = ''
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0
    const second = bytes[index + 1]
    const third = bytes[index + 2]
    const chunk = (first << 16) | ((second ?? 0) << 8) | (third ?? 0)

    output += BASE64_ALPHABET[(chunk >> 18) & 63]
    output += BASE64_ALPHABET[(chunk >> 12) & 63]
    output += second === undefined ? '=' : BASE64_ALPHABET[(chunk >> 6) & 63]
    output += third === undefined ? '=' : BASE64_ALPHABET[chunk & 63]
  }
  return output
}

/** Decode base64 bytes for placeholder sizing and hashing. */
export function base64ToBytes(base64: string): Uint8Array {
  const values: number[] = []

  for (const char of base64.replace(/\s/g, '')) {
    if (char === '=') continue
    const value = BASE64_LOOKUP.get(char)
    if (value !== undefined) values.push(value)
  }

  const byteLength = Math.floor((values.length * 6) / 8)
  const bytes = new Uint8Array(byteLength)
  let buffer = 0
  let bits = 0
  let offset = 0

  for (const value of values) {
    buffer = (buffer << 6) | value
    bits += 6
    if (bits >= 8 && offset < bytes.length) {
      bits -= 8
      bytes[offset] = (buffer >> bits) & 255
      offset += 1
    }
  }

  return bytes
}
