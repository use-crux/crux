import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../ui/src/", import.meta.url));
const errors = [];

const forbiddenRootDirs = ["components", "views", "hooks", "lib"];
for (const dir of forbiddenRootDirs) {
  const path = join(root, dir);
  if (existsSync(path)) {
    errors.push(`legacy root directory must not exist: ui/src/${dir}`);
  }
}

const forbiddenImports = [
  "@/components",
  "@/views",
  "@/hooks",
  "@/lib",
  "../components",
  "../../components",
  "../views",
  "../../views",
];

// Deliberate feature→feature edges only. Prefer shared/ for truly generic UI.
const allowedFeatureImports = new Map([
  // Run Detail reuses Catalog injection-state chips and observability graphs.
  ["run-detail", new Set(["observability", "index"])],
  ["runs", new Set(["observability"])],
  ["overview", new Set(["observability"])],
  ["search", new Set(["observability", "index"])],
  ["index", new Set(["memory", "plans", "workspaces"])],
  // Evaluations surface scorer-owned judge agreement reports in detail.
  ["evaluations", new Set(["scorers"])],
]);

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      out.push(...walk(path));
    } else if (/\.(ts|tsx)$/.test(name)) {
      out.push(path);
    }
  }
  return out;
}

function currentFeature(relPath) {
  const parts = relPath.split(sep);
  return parts[0] === "features" ? parts[1] : undefined;
}

for (const file of walk(root)) {
  const rel = relative(root, file);
  const text = readFileSync(file, "utf8");
  for (const spec of forbiddenImports) {
    if (text.includes(spec)) {
      errors.push(`${rel}: forbidden legacy import prefix ${spec}`);
    }
  }

  if (
    text.includes("@use-crux/core/eval/internal") ||
    text.includes("/eval/internal/")
  ) {
    errors.push(`${rel}: UI must not import Eval engine internals`);
  }

  const sourceFeature = currentFeature(rel);
  if (!sourceFeature) continue;

  if (
    rel.includes(`${sep}components${sep}`) &&
    /@\/features\/[^/'"]+\/services\//.test(text)
  ) {
    errors.push(
      `${rel}: components must call feature hooks, not services directly`,
    );
  }
  for (const match of text.matchAll(/@\/features\/([^/'"]+)/g)) {
    const targetFeature = match[1];
    if (targetFeature === sourceFeature) continue;
    const allowed = allowedFeatureImports
      .get(sourceFeature)
      ?.has(targetFeature);
    if (!allowed) {
      errors.push(
        `${rel}: feature ${sourceFeature} imports feature ${targetFeature}`,
      );
    }
  }
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log("ui architecture guard passed");
