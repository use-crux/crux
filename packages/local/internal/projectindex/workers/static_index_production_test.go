package workers

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
)

func writeStaticIndexNativeConfig(t testing.TB, root string) string {
	t.Helper()
	configPath := filepath.Join("packages", "indexer", ".crux", "cache", "static-index-native.config.ts")
	absoluteConfigPath := filepath.Join(root, configPath)
	if err := os.MkdirAll(filepath.Dir(absoluteConfigPath), 0o755); err != nil {
		t.Fatalf("create Static Index native config dir: %v", err)
	}
	source := []byte("import { config } from '@use-crux/core'\n\nexport default config({\n  experimental: { indexer: { nativeAst: { frontend: 'oxc' } } },\n})\n")
	if err := os.WriteFile(absoluteConfigPath, source, 0o600); err != nil {
		t.Fatalf("write Static Index native config: %v", err)
	}
	t.Cleanup(func() {
		_ = os.Remove(absoluteConfigPath)
	})
	return configPath
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

func assertNativeStaticIndexPathRan(t testing.TB, timing ProjectIndexAstTiming) {
	t.Helper()
	if timing.UsedStaticIndex && timing.NativeParseAndForwardMs > 0 {
		return
	}
	t.Fatalf(
		"native static index path did not run: usedStaticIndex=%v nativeParseForwardMs=%0.3f nodeReasons=%v totalMs=%0.3f",
		timing.UsedStaticIndex,
		timing.NativeParseAndForwardMs,
		timing.NodeReasons,
		timing.TotalMs,
	)
}
