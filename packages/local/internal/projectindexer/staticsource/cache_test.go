package staticsource

import (
	"os"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/devtools"
	"github.com/use-crux/crux/packages/local/internal/projectindexer/staticcache"
	"github.com/use-crux/crux/packages/local/internal/projectindexer/staticplan"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestProjectNativeStaticSourceInputUsesCachedProfileWithoutRereadingWarmHits(t *testing.T) {
	t.Setenv(staticcache.StatusEnv, "1")

	root := t.TempDir()
	sourceText := "import { support } from './support'\nexport const writer = prompt({ id: support })\n"
	supportText := "export const support = 'warm-cache'\n"
	sourceFile := writeNativeStaticPlanCacheFixtureFile(t, root, "src/writer.ts", sourceText)
	supportFile := writeNativeStaticPlanCacheFixtureFile(t, root, "src/support.ts", supportText)
	sourceHash := nativeStaticPlanCacheFixtureHash(t, sourceFile)

	cacheKey := "static-cache-key:writer"
	profile := devtools.SemanticSourceProfileFile{
		File:        sourceFile,
		SourceHash:  sourceHash,
		SourceBytes: len([]byte(sourceText)),
		Hints: &devtools.SemanticSourceProfileHints{
			CruxCallNames:             []string{"prompt"},
			NativeDirectCruxCandidate: true,
		},
	}
	if err := staticcache.WriteExtraction(root, cacheKey, staticcache.WritableExtraction{
		File:            sourceFile,
		Definitions:     []store.ProjectDefinition{},
		Relations:       []store.ProjectRelation{},
		Diagnostics:     []store.IndexDiagnostic{},
		Dependencies:    []string{supportFile},
		SemanticProfile: &profile,
	}); err != nil {
		t.Fatalf("write cache extraction: %v", err)
	}
	writeNativeStaticPlanCacheManifest(t, root, map[string]any{
		"version":    staticcache.Epoch,
		"root":       root,
		"file":       "src/writer.ts",
		"sourceHash": sourceHash,
		"dependencies": []map[string]string{{
			"file":       "src/support.ts",
			"sourceHash": nativeStaticPlanCacheFixtureHash(t, supportFile),
		}},
		"configFiles":    []map[string]string{},
		"compilerInputs": nativeStaticPlanCacheCompilerInputsFixture(t),
		"cacheKey":       cacheKey,
	})

	plan, err := staticplan.Build(root, "warm-cache", devtools.ProjectNativeStaticConfig{
		Root:             root,
		NativeAstEnabled: true,
	})
	if err != nil {
		t.Fatalf("staticplan.Build error = %v", err)
	}
	if len(plan.FilesToParse) != 0 {
		t.Fatalf("files to parse = %v, want none for full warm cache hit", plan.FilesToParse)
	}
	if err := os.Remove(sourceFile); err != nil {
		t.Fatalf("remove cached source: %v", err)
	}
	if err := os.Remove(supportFile); err != nil {
		t.Fatalf("remove cached support: %v", err)
	}

	sourceInput, err := InputFromPlan(plan)
	if err != nil {
		t.Fatalf("source input from full warm hit plan: %v", err)
	}
	if !nativeStaticPrepareFilesContain(sourceInput.Files, sourceFile) {
		t.Fatalf("prepare files = %+v, want cached source identity", sourceInput.Files)
	}
	if nativeStaticPrepareFilesContain(sourceInput.Files, supportFile) {
		t.Fatalf("prepare files = %+v, want non-parsed support file omitted", sourceInput.Files)
	}
	if !nativeStaticPrepareFilesContain(sourceInput.PrimaryFiles, sourceFile) {
		t.Fatalf("primary files = %+v, want cached source primary identity", sourceInput.PrimaryFiles)
	}
	if len(sourceInput.SourceTextByFile) != 0 {
		t.Fatalf("source text entries = %v, want none for full warm cache hit", sourceInput.SourceTextByFile)
	}
	if sourceInput.SemanticSourceProfile == nil || len(sourceInput.SemanticSourceProfile.Files) != 1 {
		t.Fatalf("semantic source profile = %+v, want cached source profile", sourceInput.SemanticSourceProfile)
	}
	gotProfile := sourceInput.SemanticSourceProfile.Files[0]
	if gotProfile.File != sourceFile || gotProfile.SourceHash != sourceHash || gotProfile.SourceBytes != len([]byte(sourceText)) {
		t.Fatalf("semantic source profile file = %+v, want cached source profile", gotProfile)
	}
}
