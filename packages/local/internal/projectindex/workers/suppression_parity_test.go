package workers

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/devtools"
	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/projectindex/oneshot"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/frontend"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestWorkerLintFinalizerRetainsSuppressedExtensionFinding(t *testing.T) {
	if os.Getenv(frontend.WorkerEnv) == "" {
		t.Skipf("set %s to run production Static Index lint finalizer test", frontend.WorkerEnv)
	}
	root := t.TempDir()
	sourceFile := filepath.Join(root, "workflow.ts")
	if err := os.WriteFile(sourceFile, []byte("// crux-lint-disable-next-line @acme/rules/require-owner -- intentional handoff\nworkflow();\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	worker := newTestWorker(t)
	t.Cleanup(func() { _ = worker.Close() })

	patch, err := worker.IndexProjectLintPatch(context.Background(), projectindex.ProjectLintIndexRequest{
		Root: root, ProjectName: "suppressed-extension", ASTUsedStaticIndex: true,
		PreviousIndex: store.IndexData{
			Definitions: []store.ProjectDefinition{{
				ID: "prompt:writer", Kind: "prompt", Name: "writer", Fidelity: "resolved",
				Source: &store.SourceLoc{File: sourceFile, Line: 2},
			}},
			Sources: []store.IndexSourceFile{{File: sourceFile, Status: "indexed"}},
			RuleDescriptors: []store.IndexRuleDescriptor{{
				ID: "@acme/rules/require-owner", Source: "extension", Title: "Require owner", Description: "Requires an owner.",
			}},
		},
		Prefetch: &projectindex.ProjectLintPrefetchResult{RuleFacts: []json.RawMessage{json.RawMessage(`{
			"lintFindings":[{
				"id":"rule:owner:workflow",
				"ruleId":"@acme/rules/require-owner",
				"severity":"warning",
				"title":"Require owner",
				"message":"Workflow is missing an owner.",
				"source":{"file":"` + sourceFile + `","line":2,"column":1},
				"evidence":[]
			}]
		}`)}},
	})
	if err != nil {
		t.Fatalf("IndexProjectLintPatch error = %v", err)
	}
	for _, finding := range patch.Facts.LintFindings {
		if finding.ID != "rule:owner:workflow" {
			continue
		}
		if !finding.Suppressed || finding.SuppressedBy == nil {
			t.Fatalf("finding = %+v, want retained suppression metadata", finding)
		}
		if finding.SuppressedBy.Scope != "next-line" || finding.SuppressedBy.Reason != "intentional handoff" || finding.SuppressedBy.Source == nil || finding.SuppressedBy.Source.Line != 1 {
			t.Fatalf("suppressedBy = %+v, want exact directive evidence", finding.SuppressedBy)
		}
		return
	}
	t.Fatalf("lint findings = %+v, want extension finding", patch.Facts.LintFindings)
}

func TestWorkerRetainsSuppressedExtensionFindingInDaemonAndOneShotModes(t *testing.T) {
	if _, err := findNodePath(); err != nil {
		t.Skipf("node unavailable: %v", err)
	}
	if os.Getenv(frontend.WorkerEnv) == "" {
		t.Skipf("set %s to run production Static Index suppression parity test", frontend.WorkerEnv)
	}

	root := t.TempDir()
	writeExtensionParityProject(t, root)
	writeFile(
		t,
		filepath.Join(root, "src", "workflow.ts"),
		`import { prompt } from '@use-crux/core'
import { defineWorkflow } from '@acme/workflows'

export const writerPrompt = prompt({ id: 'writer', prompt: 'Write.' })
// crux-lint-disable-next-line @acme/crux-indexer-extension/require-owner -- intentional handoff
export const publishWorkflow = defineWorkflow({ id: 'publish' })
`,
	)

	worker := newTestWorker(t)
	t.Cleanup(func() { _ = worker.Close() })

	daemon := devtools.NewService(store.NewStore(), nil).
		WithFactStore(nil).
		WithProjectIndexer(worker)
	t.Cleanup(daemon.Shutdown)
	daemonIndex, err := daemon.ReindexProjectWithOptions(
		context.Background(), root, "crux.config.ts", "suppression-parity",
		devtools.ProjectReindexOptions{Semantic: devtools.ProjectSemanticInline},
	)
	if err != nil {
		t.Fatalf("daemon reindex: %v", err)
	}

	oneShot, err := oneshot.NewReadOnly(worker).Run(context.Background(), oneshot.Options{
		Root: root, ConfigPath: "crux.config.ts", ProjectID: "suppression-parity",
	})
	if err != nil {
		t.Fatalf("one-shot reindex: %v", err)
	}

	daemonFinding := requireSuppressedExtensionFinding(t, daemonIndex)
	oneShotFinding := requireSuppressedExtensionFinding(t, oneShot.Index)
	requireNoUnusedSuppressionDiagnostic(t, daemonIndex)
	requireNoUnusedSuppressionDiagnostic(t, oneShot.Index)
	if daemonFinding.SuppressedBy.Scope != oneShotFinding.SuppressedBy.Scope ||
		daemonFinding.SuppressedBy.Reason != oneShotFinding.SuppressedBy.Reason ||
		daemonFinding.SuppressedBy.Source.File != oneShotFinding.SuppressedBy.Source.File ||
		daemonFinding.SuppressedBy.Source.Line != oneShotFinding.SuppressedBy.Source.Line {
		t.Fatalf("daemon suppression = %+v; one-shot suppression = %+v", daemonFinding.SuppressedBy, oneShotFinding.SuppressedBy)
	}
}

func requireNoUnusedSuppressionDiagnostic(t testing.TB, index store.IndexData) {
	t.Helper()
	for _, diagnostic := range index.Diagnostics {
		if diagnostic.Code == "index.lint_unused_suppression" {
			t.Fatalf("diagnostics = %+v, matched directive must not remain unused", index.Diagnostics)
		}
	}
}

func requireSuppressedExtensionFinding(t testing.TB, index store.IndexData) store.IndexLintFinding {
	t.Helper()
	for _, finding := range index.LintFindings {
		if finding.RuleID != "@acme/crux-indexer-extension/require-owner" {
			continue
		}
		if !finding.Suppressed || finding.SuppressedBy == nil || finding.SuppressedBy.Source == nil {
			t.Fatalf("finding = %+v, want retained suppression metadata", finding)
		}
		if finding.SuppressedBy.Scope != "next-line" || finding.SuppressedBy.Reason != "intentional handoff" {
			t.Fatalf("suppressedBy = %+v, want exact directive evidence", finding.SuppressedBy)
		}
		return finding
	}
	t.Fatalf("lint findings = %+v, want suppressed extension finding", index.LintFindings)
	return store.IndexLintFinding{}
}
