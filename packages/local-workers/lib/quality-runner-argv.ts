/**
 * Small argv helpers for the Quality worker entrypoint.
 *
 * These helpers intentionally stay minimal: the Go CLI owns public argument
 * parsing, while the worker only needs stable flag extraction from a trusted
 * spawn contract.
 *
 * @module
 */

const VALUE_FLAGS = new Set([
  '--config',
  '--case',
  '--variant',
  '--replay',
  '--trials',
  '--experiment',
  '--max-concurrency',
  '--promote',
  '--pin-id',
  '--diff-a',
  '--diff-b',
])

/** Return positional args after skipping worker flags with values. */
export function positionalArgs(args: readonly string[]): string[] {
  const positionals: string[] = []
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!
    if (VALUE_FLAGS.has(arg)) {
      index++
      continue
    }
    if (arg.startsWith('--')) continue
    positionals.push(arg)
  }
  return positionals
}

/** Return the first value for a worker flag. */
export function getArg(args: readonly string[], name: string): string | undefined {
  const idx = args.indexOf(name)
  if (idx === -1 || idx + 1 >= args.length) return undefined
  return args[idx + 1]
}

/** Return all values for a repeatable worker flag. */
export function getRepeatedArg(args: readonly string[], name: string): string[] {
  const values: string[] = []
  for (let index = 0; index < args.length; index++) {
    if (args[index] === name && index + 1 < args.length) {
      values.push(args[index + 1]!)
      index++
    }
  }
  return values
}

/** Return whether a boolean worker flag is present. */
export function hasFlag(args: readonly string[], name: string): boolean {
  return args.includes(name)
}
