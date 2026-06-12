/**
 * ULID generation for experiment and baseline ids.
 *
 * Experiments are keyed by ULIDs (spec 02 §1) so directory listings sort by
 * creation time without a separate index. Crockford base32: 10 chars of
 * millisecond timestamp + 16 chars of randomness, monotonic within one
 * millisecond so rapid runs never collide or reorder.
 *
 * @internal Not exported from `@crux/core/quality` — engine plumbing only.
 * @module
 */

import { randomBytes } from 'node:crypto'

const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const TIME_LENGTH = 10
const RANDOM_LENGTH = 16

let lastTime = -1
let lastRandom: number[] = []

function encodeTime(time: number): string {
  let value = time
  let out = ''
  for (let i = 0; i < TIME_LENGTH; i++) {
    out = ENCODING[value % 32] + out
    value = Math.floor(value / 32)
  }
  return out
}

function randomDigits(): number[] {
  const bytes = randomBytes(RANDOM_LENGTH)
  return Array.from(bytes, (byte) => byte % 32)
}

/** Increment the random component for same-millisecond monotonicity. */
function incrementRandom(digits: number[]): number[] {
  const next = [...digits]
  for (let i = next.length - 1; i >= 0; i--) {
    const incremented = next[i]! + 1
    if (incremented < 32) {
      next[i] = incremented
      return next
    }
    next[i] = 0
  }
  // Random component overflowed (astronomically unlikely): start fresh.
  return randomDigits()
}

/**
 * Generate a ULID — sortable by creation time, monotonic within a
 * millisecond.
 *
 * @param time - Timestamp override in epoch milliseconds (tests/determinism).
 *
 * @internal
 */
export function ulid(time: number = Date.now()): string {
  if (time === lastTime) {
    lastRandom = incrementRandom(lastRandom)
  } else {
    lastTime = time
    lastRandom = randomDigits()
  }
  return encodeTime(time) + lastRandom.map((digit) => ENCODING[digit]).join('')
}
