import { readFile } from "node:fs/promises";
import { join } from "node:path";

const FILES = [".env.local", ".env.dev", ".env"] as const;

/** Read Eval host environment precedence without mutating `process.env`. */
export async function readEvalHostEnvironment(
  projectRoot: string,
  processEnvironment: NodeJS.ProcessEnv = process.env,
): Promise<Readonly<Record<string, string | undefined>>> {
  const values: Record<string, string | undefined> = { ...processEnvironment };
  const protectedKeys = new Set(Object.keys(processEnvironment));
  for (const file of FILES) {
    const parsed = await readEnvironmentFile(join(projectRoot, file));
    for (const [key, value] of Object.entries(parsed)) {
      if (!protectedKeys.has(key) && values[key] === undefined)
        values[key] = value;
    }
  }
  return Object.freeze(values);
}

async function readEnvironmentFile(path: string) {
  let source: string;
  try {
    source = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  return Object.fromEntries(
    source.split(/\r?\n/).flatMap((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return [];
      const separator = trimmed.indexOf("=");
      if (separator < 1) return [];
      const key = trimmed.slice(0, separator).trim();
      let value = trimmed.slice(separator + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      return [[key, value]];
    }),
  );
}
