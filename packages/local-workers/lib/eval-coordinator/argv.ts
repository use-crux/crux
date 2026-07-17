/** Minimal flag extraction for the trusted Go-to-Eval coordinator contract. */

const valueFlags = new Set(["--case", "--max-cost", "--variant", "--baseline-set"]);

/** Return positional selectors after skipping flags with values. */
export function positionalArgs(args: readonly string[]): string[] {
  const positionals: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!;
    if (valueFlags.has(argument)) {
      index++;
      continue;
    }
    if (!argument.startsWith("--")) positionals.push(argument);
  }
  return positionals;
}

/** Return the first value for a worker flag. */
export function getArg(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 || index + 1 >= args.length ? undefined : args[index + 1];
}

/** Return all values for a repeatable worker flag. */
export function getRepeatedArg(args: readonly string[], name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index++) {
    if (args[index] === name && index + 1 < args.length) values.push(args[++index]!);
  }
  return values;
}

/** Return whether a boolean worker flag is present. */
export function hasFlag(args: readonly string[], name: string): boolean {
  return args.includes(name);
}
