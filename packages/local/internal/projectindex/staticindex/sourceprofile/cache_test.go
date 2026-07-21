package sourceprofile

import (
	"os"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/cache"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/planner"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestProjectStaticIndexSourceInputUsesCachedProfileWithoutRereadingWarmHits(t *testing.T) {
	t.Setenv(cache.StatusEnv, "1")

	root := t.TempDir()
	sourceText := "import { support } from './support'\nexport const writer = prompt({ id: support })\n"
	supportText := "export const support = 'warm-cache'\n"
	sourceFile := writeFixtureFile(t, root, "src/writer.ts", sourceText)
	supportFile := writeFixtureFile(t, root, "src/support.ts", supportText)
	sourceHash := fixtureHash(t, sourceFile)

	cacheKey := "static-cache-key:writer"
	profile := projectindex.SemanticSourceProfileFile{
		File:        sourceFile,
		SourceHash:  sourceHash,
		SourceBytes: len([]byte(sourceText)),
		Hints: &projectindex.SemanticSourceProfileHints{
			CruxCallNames:             []string{"prompt"},
			NativeDirectCruxCandidate: true,
		},
	}
	if err := cache.WriteExtraction(root, cacheKey, cache.WritableExtraction{
		File:            sourceFile,
		Definitions:     []store.ProjectDefinition{},
		Relations:       []store.ProjectRelation{},
		Diagnostics:     []store.IndexDiagnostic{},
		Dependencies:    []string{supportFile},
		SemanticProfile: &profile,
	}); err != nil {
		t.Fatalf("write cache extraction: %v", err)
	}
	writeManifest(t, root, map[string]any{
		"version":    cache.Epoch,
		"root":       root,
		"file":       "src/writer.ts",
		"sourceHash": sourceHash,
		"dependencies": []map[string]string{{
			"file":       "src/support.ts",
			"sourceHash": fixtureHash(t, supportFile),
		}},
		"configFiles":    []map[string]string{},
		"compilerInputs": compilerInputsFixture(t),
		"cacheKey":       cacheKey,
	})

	plan, err := planner.Build(root, "warm-cache", projectindex.ProjectStaticIndexConfig{
		Root: root,
	})
	if err != nil {
		t.Fatalf("planner.Build error = %v", err)
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

	sourceInput, err := FromPlan(plan)
	if err != nil {
		t.Fatalf("source input from full warm hit plan: %v", err)
	}
	if !containsPreparedFile(sourceInput.Files, sourceFile) {
		t.Fatalf("prepare files = %+v, want cached source identity", sourceInput.Files)
	}
	if containsPreparedFile(sourceInput.Files, supportFile) {
		t.Fatalf("prepare files = %+v, want non-parsed support file omitted", sourceInput.Files)
	}
	if !containsPreparedFile(sourceInput.PrimaryFiles, sourceFile) {
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
