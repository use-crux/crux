import { relative } from "node:path";

/** Create a stable relative source import without its TypeScript extension. */
export function importSpecifier(fromDir: string, toFile: string): string {
  const withoutExtension = toFile.replace(/\.(tsx?|jsx?|mjs|cjs)$/, "");
  let specifier = relative(fromDir, withoutExtension).replace(/\\/g, "/");
  if (!specifier.startsWith(".")) specifier = `./${specifier}`;
  return specifier;
}
