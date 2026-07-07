package workers

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/frontend"
)

func TestWorkerNativeStaticIndexUsesTypeScriptExtensionHostInProductionPath(t *testing.T) {
	if _, err := findNodePath(); err != nil {
		t.Skipf("node unavailable: %v", err)
	}
	if os.Getenv(frontend.WorkerEnv) == "" {
		t.Skipf("set %s to run production Static Index extension host test", frontend.WorkerEnv)
	}

	root := t.TempDir()
	writeExtensionParityProject(t, root)

	worker := newTestWorker(t)
	defer worker.Close()

	config, err := worker.InspectProjectStaticIndexConfig(context.Background(), root, "crux.config.ts")
	if err != nil {
		t.Fatalf("inspect static index config: %v", err)
	}
	if !config.StaticSyntaxEnabled || len(config.Extensions) != 1 || len(config.Diagnostics) != 0 {
		t.Fatalf("static index config = %+v, want nativeAst enabled with one extension and no diagnostics", config)
	}

	plan, err := worker.InspectProjectStaticSyntaxPlan(context.Background(), root, "crux.config.ts", "parity-extension-fallback")
	if err != nil {
		t.Fatalf("inspect extension static syntax plan: %v", err)
	}
	if !containsTimingReason(plan.CallNames, "defineWorkflow") ||
		!strings.Contains(string(plan.StaticHost), `"extensionTypeScriptExtractorCount":1`) ||
		!strings.Contains(string(plan.StaticHost), `"typeScriptRuleCount":1`) {
		t.Fatalf("plan did not include extension fallback manifest: callNames=%v staticHost=%s", plan.CallNames, string(plan.StaticHost))
	}

	facts, err := productionStaticIndexFinalFacts(context.Background(), worker, root, "crux.config.ts", "parity-extension-host")
	if err != nil {
		t.Fatalf("native production static index with extension host error = %v", err)
	}
	assertNativeStaticIndexPathRan(t, worker.LastAstTiming())
	assertHasDefinition(t, facts, "prompt:writer")
	assertHasDefinition(t, facts, "@acme/workflow:publish")
	assertHasLintFinding(t, facts, "@acme/crux-indexer-extension/require-owner")
}

func writeExtensionParityProject(t testing.TB, root string) {
	t.Helper()
	writeFile(t, filepath.Join(root, "package.json"), `{"type":"module"}`)
	writeCoreConfigStubPackage(t, root)
	linkNodePackageFromRepository(t, root, "tsx")
	writeExtensionParityPackage(t, root)
	writeFile(
		t,
		filepath.Join(root, "crux.config.ts"),
		`import { config } from '@use-crux/core'

const nativeAst = true

export default config({
  experimental: { indexer: { nativeAst } },
  lint: { profile: 'recommended' },
  indexer: {
    extensions: [{ package: '@acme/crux-indexer-extension', version: '^1.0.0' }],
    trust: { mode: 'allowlisted', allow: ['@acme/crux-indexer-extension'] },
  },
})
`,
	)
	writeFile(
		t,
		filepath.Join(root, "src", "workflow.ts"),
		`import { prompt } from '@use-crux/core'
import { defineWorkflow } from '@acme/workflows'

export const writerPrompt = prompt({ id: 'writer', prompt: 'Write.' })
export const publishWorkflow = defineWorkflow({ id: 'publish' })
`,
	)
}

func writeCoreConfigStubPackage(t testing.TB, root string) {
	t.Helper()
	packageRoot := filepath.Join(root, "node_modules", "@use-crux", "core")
	writeFile(t, filepath.Join(packageRoot, "package.json"), `{"name":"@use-crux/core","version":"0.1.0","type":"module","exports":"./index.mjs"}`)
	writeFile(
		t,
		filepath.Join(packageRoot, "index.mjs"),
		`export function config(value) {
  return Object.freeze({
    prompts: Object.freeze([]),
    contexts: Object.freeze([]),
    get() { throw new Error('fixture config registry is inert') },
    find() { return undefined },
    list() { return [] },
    byTag() { return [] },
    byTags() { return [] },
    tags() { return [] },
    config: Object.freeze({ ...value }),
    dispose() {},
  })
}

export function prompt(value) {
  return value
}
`,
	)
}

func writeExtensionParityPackage(t testing.TB, root string) {
	t.Helper()
	packageRoot := filepath.Join(root, "node_modules", "@acme", "crux-indexer-extension")
	writeFile(t, filepath.Join(packageRoot, "package.json"), `{"name":"@acme/crux-indexer-extension","version":"1.0.0","type":"module","exports":"./index.mjs"}`)
	writeFile(
		t,
		filepath.Join(packageRoot, "index.mjs"),
		`export default {
  name: '@acme/crux-indexer-extension',
  version: '1',
  crux: { indexer: '^0.1.0', projectIndexSchema: 1 },
  static: {
    evidence: { mode: 'declared' },
    interests: {
      calls: [{ name: 'defineWorkflow', importFrom: ['@acme/workflows'], configArg: 0 }],
    },
  },
  extractors: [
    {
      name: 'workflow.define',
      patterns: [{ kind: 'call', name: 'defineWorkflow', importFrom: ['@acme/workflows'], configArg: 0 }],
      extract(ctx) {
        const id = ctx.config?.string('id') ?? ctx.source.localName
        return {
          kind: 'facts',
          facts: {
            definitions: [
              ctx.define.definition({
                variableName: ctx.source.variableName,
                id: '@acme/workflow:' + ctx.source.safeId(id),
                kind: '@acme/workflow',
                name: id,
                metadata: { extension: '@acme/crux-indexer-extension' },
              }),
            ],
          },
        }
      },
    },
  ],
  rules: [
    {
      manifest: {
        id: '@acme/crux-indexer-extension/require-owner',
        docs: { description: 'Require workflow owner metadata.' },
        phase: 'index',
        requires: ['definitions'],
        fidelity: 'safe',
        defaultSeverity: 'warning',
      },
      messages: { missing: 'Workflow owner is missing.' },
      check({ definitions }) {
        return definitions
          .filter((definition) => definition.kind === '@acme/workflow')
          .map((definition) => ({
            id: 'lint:@acme/crux-indexer-extension/require-owner:' + definition.id,
            ruleId: '@acme/crux-indexer-extension/require-owner',
            severity: 'warning',
            category: 'extension',
            maturity: 'preview',
            confidence: 'high',
            title: 'Workflow owner is missing',
            message: 'Workflow "' + definition.name + '" is missing owner metadata.',
            relatedDefinitionIds: [definition.id],
            affectedDefinitionIds: [definition.id],
            evidence: [{ kind: 'definition', definitionId: definition.id, label: 'Workflow without owner metadata' }],
            fixes: [],
          }))
      },
    },
  ],
}
`,
	)
}

func writeFile(t testing.TB, path string, source string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("create %s parent: %v", path, err)
	}
	if err := os.WriteFile(path, []byte(source), 0o600); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

func linkNodePackageFromRepository(t testing.TB, root string, packageName string) {
	t.Helper()
	packageRoot := filepath.Join(root, "node_modules", filepath.FromSlash(packageName))
	if err := os.MkdirAll(filepath.Dir(packageRoot), 0o755); err != nil {
		t.Fatalf("create %s parent: %v", packageRoot, err)
	}
	target := repositoryNodePackageRoot(t, packageName)
	if err := os.Symlink(target, packageRoot); err != nil {
		t.Fatalf("link %s to %s: %v", packageRoot, target, err)
	}
}

func repositoryNodePackageRoot(t testing.TB, packageName string) string {
	t.Helper()
	root := repositoryRoot(t)
	direct := filepath.Join(root, "node_modules", filepath.FromSlash(packageName))
	if _, err := os.Stat(direct); err == nil {
		return direct
	}
	matches, err := filepath.Glob(filepath.Join(root, "node_modules", ".pnpm", packageName+"@*", "node_modules", filepath.FromSlash(packageName)))
	if err != nil {
		t.Fatalf("resolve %s from repository node_modules: %v", packageName, err)
	}
	if len(matches) == 0 {
		t.Fatalf("repository node_modules does not contain %s", packageName)
	}
	return matches[0]
}

func repositoryRoot(t testing.TB) string {
	t.Helper()
	root := os.Getenv("CRUX_INDEXER_PARITY_ROOT")
	if root != "" {
		return root
	}
	wd, err := os.Getwd()
	if err != nil {
		t.Fatalf("get working directory: %v", err)
	}
	return filepath.Clean(filepath.Join(wd, "..", "..", "..", ".."))
}

func assertHasDefinition(t testing.TB, facts projectindex.IndexPatchFacts, id string) {
	t.Helper()
	for _, definition := range facts.Definitions {
		if definition.ID == id {
			return
		}
	}
	t.Fatalf("definitions did not include %q", id)
}

func assertHasLintFinding(t testing.TB, facts projectindex.IndexPatchFacts, ruleID string) {
	t.Helper()
	for _, finding := range facts.LintFindings {
		if finding.RuleID == ruleID {
			return
		}
	}
	t.Fatalf("lint findings did not include rule %q", ruleID)
}
