package server

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/devtools"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestProjectIndexWorkerNativeStaticSchedulesTypeScriptRulesInLintPhase(t *testing.T) {
	if _, err := findNodePath(); err != nil {
		t.Skipf("node unavailable: %v", err)
	}

	root := t.TempDir()
	sourceFile := filepath.Join(root, "src", "writer.ts")
	if err := os.MkdirAll(filepath.Dir(sourceFile), 0o755); err != nil {
		t.Fatalf("mkdir src: %v", err)
	}
	if err := os.WriteFile(sourceFile, []byte("export const writer = prompt({ id: 'rule-input' })"), 0o600); err != nil {
		t.Fatalf("write source: %v", err)
	}
	writeNativeStaticEnabledConfig(t, root)

	script := filepath.Join(t.TempDir(), "native-static-rules-indexer.mjs")
	if err := os.WriteFile(script, []byte(nativeStaticRulesIndexerScript()), 0o600); err != nil {
		t.Fatalf("write script: %v", err)
	}

	compiler := &nativeStaticRuleCompiler{root: root, sourceFile: sourceFile}
	worker := NewProjectIndexWorker(script)
	worker.WithProjectSyntaxWorker(compiler)
	defer worker.Close()

	patch, err := worker.IndexProjectAstPatch(context.Background(), root, "", "native-static-rules")
	if err != nil {
		t.Fatalf("IndexProjectAstPatch error = %v", err)
	}
	if len(patch.Facts.LintFindings) != 0 {
		t.Fatalf("AST lint findings = %+v, want extension rules deferred to quality phase", patch.Facts.LintFindings)
	}
	if compiler.finalizeCalls != 1 {
		t.Fatalf("finalize calls after AST = %d, want graph finalize only", compiler.finalizeCalls)
	}

	lintPatch, err := worker.IndexProjectLintPatch(context.Background(), devtools.ProjectLintIndexRequest{
		Root:                root,
		ConfigPath:          "",
		ProjectName:         "native-static-rules",
		ASTUsedNativeStatic: true,
		PreviousIndex: store.IndexData{
			Definitions:     patch.Facts.Definitions,
			Relations:       patch.Facts.Relations,
			RuleDescriptors: patch.Facts.RuleDescriptors,
			Sources:         patch.Facts.Sources,
			SourceGraph:     patch.Facts.SourceGraph,
		},
	})
	if err != nil {
		t.Fatalf("IndexProjectLintPatch error = %v", err)
	}
	if lintPatch.Phase != "quality" {
		t.Fatalf("lint patch phase = %q, want quality", lintPatch.Phase)
	}
	if compiler.finalizeCalls != 2 {
		t.Fatalf("finalize calls = %d, want graph finalize then quality finalize", compiler.finalizeCalls)
	}
	if len(lintPatch.Facts.LintFindings) != 1 || lintPatch.Facts.LintFindings[0].ID != "rule:native-rule" {
		t.Fatalf("quality lint findings = %+v, want TS rule finding", lintPatch.Facts.LintFindings)
	}
	if !bytes.Contains(compiler.finalizeExtensionFacts, []byte("rule:native-rule")) {
		t.Fatalf("finalize extension facts = %s, want TypeScript rule facts", compiler.finalizeExtensionFacts)
	}
}
