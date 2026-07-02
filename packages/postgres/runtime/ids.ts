import { randomUUID } from 'node:crypto'

export function newRuntimeId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll('-', '')}`
}
