/**
 * .env file loader for CLI commands.
 *
 * Reads `.env.local` > `.env.dev` > `.env` from `process.cwd()`,
 * never overriding existing environment variables.
 *
 * @module
 */

import { resolve } from 'node:path'
import { readFileSync, existsSync } from 'node:fs'

function loadEnvFile(filePath: string) {
  if (!existsSync(filePath)) return
  const content = readFileSync(filePath, 'utf-8')
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIndex = trimmed.indexOf('=')
    if (eqIndex === -1) continue
    const key = trimmed.slice(0, eqIndex).trim()
    let value = trimmed.slice(eqIndex + 1).trim()
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    // Don't override existing env vars
    if (process.env[key] === undefined) {
      process.env[key] = value
    }
  }
}

/**
 * Load environment variables from `.env.local`, `.env.dev`, `.env`
 * in the current working directory. Most-specific file wins
 * (because existing vars are never overridden).
 */
export function loadEnv() {
  const cwd = process.cwd()
  loadEnvFile(resolve(cwd, '.env.local'))
  loadEnvFile(resolve(cwd, '.env.dev'))
  loadEnvFile(resolve(cwd, '.env'))
}
