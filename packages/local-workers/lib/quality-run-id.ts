/**
 * ULID generation for one local quality worker process.
 *
 * This mirrors the core engine's ULID shape without exporting core internals:
 * run ids are transport metadata owned by the local worker, while experiment
 * and baseline ids remain core-owned.
 *
 * @module
 */

import { randomBytes } from 'node:crypto'

const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const TIME_LENGTH = 10
const RANDOM_LENGTH = 16

function encodeTime(time: number): string {
  let value = time
  let out = ''
  for (let index = 0; index < TIME_LENGTH; index++) {
    out = ENCODING[value % 32] + out
    value = Math.floor(value / 32)
  }
  return out
}

/** Create a sortable process-run id for the Quality runner event stream. */
export function createQualityRunId(time: number = Date.now()): string {
  const bytes = randomBytes(RANDOM_LENGTH)
  const random = Array.from(bytes, (byte) => ENCODING[byte % 32]).join('')
  return encodeTime(time) + random
}
