package workers

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/frontend"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/frontend/record"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/run/parity"
)

func TestWorkerStaticIndexMatchesTypeScriptProductionPath(t *testing.T) {
	root := requireProductionStaticParityEnv(t)
	if err := os.RemoveAll(filepath.Join(root, ".crux", "cache", "index")); err != nil {
		t.Fatalf("clear index cache: %v", err)
	}
	configPath := writeStaticIndexParityConfig(t, root)

	jsWorker := newTestWorker(t)
	jsWorker.WithSyntaxParser(nil)
	defer jsWorker.Close()
	nativeWorker := newTestWorker(t)
	defer nativeWorker.Close()

	ctx := context.Background()
	plan, err := nativeWorker.InspectProjectStaticSyntaxPlan(ctx, root, configPath, "parity-native-plan")
	if err != nil {
		t.Fatalf("inspect Static Index syntax plan: %v", err)
	}
	if !plan.StaticSyntaxEnabled {
		t.Fatalf("Static Index syntax plan did not enable nativeAst for config %q", configPath)
	}
	if len(record.Files(plan)) == 0 {
		t.Fatalf("Static Index syntax plan selected no files to parse")
	}
	jsFacts, err := productionStaticIndexFinalFacts(ctx, jsWorker, root, configPath, "parity-js")
	if err != nil {
		t.Fatalf("TypeScript production static index error = %v", err)
	}
	if err := os.RemoveAll(filepath.Join(root, ".crux", "cache", "index")); err != nil {
		t.Fatalf("clear index cache before native: %v", err)
	}
	nativeFacts, err := productionStaticIndexFinalFacts(ctx, nativeWorker, root, configPath, "parity-native")
	if err != nil {
		t.Fatalf("native production static index error = %v", err)
	}
	assertNativeSyntaxPathRan(t, nativeWorker.LastAstTiming())
	if len(jsFacts.LintFindings) == 0 {
		t.Fatalf("TypeScript production static index emitted no lint findings; parity gate would not prove final lint patch parity")
	}
	assertProjectIndexFactsEqual(
		t,
		"production project index",
		parity.ProductionFinalFacts(jsFacts),
		parity.ProductionFinalFacts(nativeFacts),
	)
}

func TestProductionStaticParityEnvRequiredFlag(t *testing.T) {
	t.Setenv("CI", "")
	t.Setenv("CRUX_INDEXER_PARITY_REQUIRED", "")
	if parityEnvRequired() {
		t.Fatal("parityEnvRequired() = true, want false without CI or explicit requirement")
	}
	t.Setenv("CRUX_INDEXER_PARITY_REQUIRED", "1")
	if !parityEnvRequired() {
		t.Fatal("parityEnvRequired() = false, want true for explicit requirement")
	}
}

func requireProductionStaticParityEnv(t testing.TB) string {
	t.Helper()
	root := os.Getenv("CRUX_INDEXER_PARITY_ROOT")
	worker := os.Getenv(frontend.WorkerEnv)
	if root != "" && worker != "" {
		return root
	}
	message := "set CRUX_INDEXER_PARITY_ROOT and " + frontend.WorkerEnv + " to run production Static Index parity"
	if parityEnvRequired() {
		t.Fatal(message)
	}
	t.Skip(message)
	return ""
}

func parityEnvRequired() bool {
	return os.Getenv("CI") != "" || os.Getenv("CRUX_INDEXER_PARITY_REQUIRED") == "1"
}

func writeStaticIndexParityConfig(t testing.TB, root string) string {
	t.Helper()
	configPath := filepath.Join("packages", "indexer", ".crux", "cache", "static-index-parity.config.ts")
	absoluteConfigPath := filepath.Join(root, configPath)
	if err := os.MkdirAll(filepath.Dir(absoluteConfigPath), 0o755); err != nil {
		t.Fatalf("create Static Index parity config dir: %v", err)
	}
	source := []byte("import { config } from '@use-crux/core'\n\nexport default config({\n  experimental: { indexer: { nativeAst: { frontend: 'oxc' } } },\n})\n")
	if err := os.WriteFile(absoluteConfigPath, source, 0o600); err != nil {
		t.Fatalf("write Static Index parity config: %v", err)
	}
	t.Cleanup(func() {
		_ = os.Remove(absoluteConfigPath)
	})
	return configPath
}

func assertNativeSyntaxPathRan(t testing.TB, timing ProjectIndexAstTiming) {
	t.Helper()
	if timing.RecordCount > 0 && timing.NativeParseAndForwardMs > 0 {
		return
	}
	if timing.NativeParseAndForwardMs > 0 && !containsTimingReason(timing.NodeReasons, projectIndexNodeReasonSyntaxRecordProjection) {
		return
	}
	t.Fatalf(
		"native syntax path did not run: recordCount=%d nativeParseForwardMs=%0.3f nodeReasons=%v totalMs=%0.3f",
		timing.RecordCount,
		timing.NativeParseAndForwardMs,
		timing.NodeReasons,
		timing.TotalMs,
	)
}

func productionStaticIndexFinalFacts(
	ctx context.Context,
	worker *Bundle,
	root string,
	configPath string,
	projectName string,
) (projectindex.IndexPatchFacts, error) {
	astResult, err := worker.IndexProjectAstPatchWithResult(ctx, root, configPath, projectName)
	if err != nil {
		return projectindex.IndexPatchFacts{}, err
	}
	state := projectindex.ApplyPatch(projectindex.EmptyPatchState(), astResult.Patch)
	lintPatch, err := worker.IndexProjectLintPatch(ctx, projectindex.ProjectLintIndexRequest{
		Root:               root,
		ConfigPath:         configPath,
		ProjectName:        projectName,
		PreviousIndex:      state.Index,
		ASTUsedStaticIndex: astResult.UsedStaticIndex,
	})
	if err != nil {
		return projectindex.IndexPatchFacts{}, err
	}
	if hasIndexPatchFacts(lintPatch.Facts) {
		state = projectindex.ApplyPatch(state, lintPatch)
	}
	return projectindex.PatchFromSnapshot(state.Index, projectindex.PhaseQuality, "ok").Facts, nil
}

func hasIndexPatchFacts(facts projectindex.IndexPatchFacts) bool {
	return len(facts.Prompts) > 0 ||
		len(facts.Contexts) > 0 ||
		len(facts.Tools) > 0 ||
		facts.Lint != nil ||
		len(facts.Definitions) > 0 ||
		len(facts.Relations) > 0 ||
		len(facts.SourceRefs) > 0 ||
		len(facts.Diagnostics) > 0 ||
		len(facts.LintFindings) > 0 ||
		len(facts.RuleDescriptors) > 0 ||
		len(facts.Sources) > 0 ||
		facts.SourceGraph != nil
}

func assertProjectIndexFactsEqual(t testing.TB, label string, want, got projectindex.IndexPatchFacts) {
	t.Helper()
	wantNormalized, wantErr := parity.NormalizeFacts(want)
	if wantErr != nil {
		t.Fatalf("normalize expected %s facts: %v", label, wantErr)
	}
	gotNormalized, gotErr := parity.NormalizeFacts(got)
	if gotErr != nil {
		t.Fatalf("normalize actual %s facts: %v", label, gotErr)
	}
	if wantNormalized == gotNormalized {
		return
	}
	dir := os.Getenv("CRUX_INDEXER_PARITY_DIFF_DIR")
	if dir == "" {
		dir = t.TempDir()
	} else if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("create %s parity diff dir: %v", label, err)
	}
	wantPath := filepath.Join(dir, "typescript-facts.json")
	gotPath := filepath.Join(dir, "native-facts.json")
	if err := os.WriteFile(wantPath, []byte(wantNormalized), 0o600); err != nil {
		t.Fatalf("write expected %s facts: %v", label, err)
	}
	if err := os.WriteFile(gotPath, []byte(gotNormalized), 0o600); err != nil {
		t.Fatalf("write actual %s facts: %v", label, err)
	}
	t.Fatalf("normalized %s facts mismatch\nTypeScript facts: %s\nNative facts: %s", label, wantPath, gotPath)
}
