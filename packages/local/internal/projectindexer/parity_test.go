package projectindexer

import (
	"context"
	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"os"
	"path/filepath"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/projectindexer/staticparity"
	"github.com/use-crux/crux/packages/local/internal/projectindexer/syntax"
	"github.com/use-crux/crux/packages/local/internal/projectindexer/syntaxrecord"
)

func TestWorkerNativeStaticMatchesTypeScriptProductionPath(t *testing.T) {
	root := os.Getenv("CRUX_INDEXER_PARITY_ROOT")
	if root == "" {
		t.Skip("set CRUX_INDEXER_PARITY_ROOT to run production static parity")
	}
	if os.Getenv(syntax.WorkerEnv) == "" {
		t.Skipf("set %s to run production native static parity", syntax.WorkerEnv)
	}
	if err := os.RemoveAll(filepath.Join(root, ".crux", "cache", "index")); err != nil {
		t.Fatalf("clear index cache: %v", err)
	}
	configPath := writeNativeStaticParityConfig(t, root)

	jsWorker := newTestWorker(t)
	jsWorker.WithSyntaxParser(nil)
	defer jsWorker.Close()
	nativeWorker := newTestWorker(t)
	defer nativeWorker.Close()

	ctx := context.Background()
	plan, err := nativeWorker.InspectProjectStaticSyntaxPlan(ctx, root, configPath, "parity-native-plan")
	if err != nil {
		t.Fatalf("inspect native static syntax plan: %v", err)
	}
	if !plan.NativeAstEnabled {
		t.Fatalf("native static syntax plan did not enable nativeAst for config %q", configPath)
	}
	if len(syntaxrecord.Files(plan)) == 0 {
		t.Fatalf("native static syntax plan selected no files to parse")
	}
	jsPatch, err := jsWorker.IndexProjectAstPatch(ctx, root, configPath, "parity-js")
	if err != nil {
		t.Fatalf("TypeScript IndexProjectAstPatch error = %v", err)
	}
	if err := os.RemoveAll(filepath.Join(root, ".crux", "cache", "index")); err != nil {
		t.Fatalf("clear index cache before native: %v", err)
	}
	nativePatch, err := nativeWorker.IndexProjectAstPatch(ctx, root, configPath, "parity-native")
	if err != nil {
		t.Fatalf("native IndexProjectAstPatch error = %v", err)
	}
	assertNativeSyntaxPathRan(t, nativeWorker.LastAstTiming())

	if len(nativePatch.Facts.LintFindings) != 0 {
		t.Fatalf("native AST lint findings = %d, want post-merge quality lint phase", len(nativePatch.Facts.LintFindings))
	}
	assertProjectIndexFactsEqual(
		t,
		"project index static graph",
		staticparity.StaticGraphFacts(jsPatch.Facts),
		staticparity.StaticGraphFacts(nativePatch.Facts),
	)
}

func writeNativeStaticParityConfig(t testing.TB, root string) string {
	t.Helper()
	configPath := filepath.Join("packages", "indexer", ".crux", "cache", "native-static-parity.config.ts")
	absoluteConfigPath := filepath.Join(root, configPath)
	if err := os.MkdirAll(filepath.Dir(absoluteConfigPath), 0o755); err != nil {
		t.Fatalf("create native static parity config dir: %v", err)
	}
	source := []byte("import { config } from '@crux/core'\n\nexport default config({\n  experimental: { indexer: { nativeAst: { frontend: 'oxc' } } },\n})\n")
	if err := os.WriteFile(absoluteConfigPath, source, 0o600); err != nil {
		t.Fatalf("write native static parity config: %v", err)
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

func assertProjectIndexFactsEqual(t testing.TB, label string, want, got projectindex.IndexPatchFacts) {
	t.Helper()
	wantNormalized, wantErr := staticparity.NormalizeFacts(want)
	if wantErr != nil {
		t.Fatalf("normalize expected %s facts: %v", label, wantErr)
	}
	gotNormalized, gotErr := staticparity.NormalizeFacts(got)
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
