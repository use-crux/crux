package workers

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/cache"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/planner"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/sourceprofile"
)

func TestProjectStaticIndexSyntaxPlanUsesWarmStaticCacheManifest(t *testing.T) {
	t.Setenv(cache.StatusEnv, "1")

	root := t.TempDir()
	sourceText := "import { support } from './support'\nexport const writer = prompt({ id: support })\n"
	supportText := "export const support = 'warm-cache'\n"
	tsconfigText := "{\"compilerOptions\":{\"module\":\"ESNext\"}}\n"
	sourceFile := writeStaticIndexPlanCacheFixtureFile(t, root, "src/writer.ts",
		sourceText)
	supportFile := writeStaticIndexPlanCacheFixtureFile(t, root, "src/support.ts",
		supportText)
	tsconfigFile := writeStaticIndexPlanCacheFixtureFile(t, root, "tsconfig.json",
		tsconfigText)

	cacheKey := "static-cache-key:writer"
	writeStaticIndexPlanCacheFile(t, root, cacheKey)
	writeStaticIndexPlanCacheManifest(t, root, map[string]any{
		"version":    cache.Epoch,
		"root":       root,
		"file":       "src/writer.ts",
		"sourceHash": staticIndexPlanCacheFixtureHash(t, sourceFile),
		"dependencies": []map[string]string{{
			"file":       "src/support.ts",
			"sourceHash": staticIndexPlanCacheFixtureHash(t, supportFile),
		}},
		"configFiles": []map[string]string{{
			"file":       "tsconfig.json",
			"sourceHash": staticIndexPlanCacheFixtureHash(t, tsconfigFile),
		}},
		"compilerInputs": staticIndexPlanCacheCompilerInputsFixture(t),
		"cacheKey":       cacheKey,
	})

	plan, err := planner.Build(root, "warm-cache", projectindex.ProjectStaticIndexConfig{
		Root:                root,
		StaticSyntaxEnabled: true,
	})
	if err != nil {
		t.Fatalf("planner.Build error = %v", err)
	}
	if !slices.Equal(plan.CacheHits, []string{sourceFile}) {
		t.Fatalf("cache hits = %v, want %v", plan.CacheHits, []string{sourceFile})
	}
	if len(plan.CacheMisses) != 0 {
		t.Fatalf("cache misses = %v, want none", plan.CacheMisses)
	}
	if len(plan.FilesToParse) != 0 {
		t.Fatalf("files to parse = %v, want none for full warm cache hit", plan.FilesToParse)
	}
	if len(plan.CacheEntries) != 1 ||
		plan.CacheEntries[0].File != sourceFile ||
		plan.CacheEntries[0].CacheKey != cacheKey ||
		plan.CacheEntries[0].SourceHash == "" {
		t.Fatalf("cache entries = %+v, want source cache key", plan.CacheEntries)
	}
	sourceInput, err := sourceprofile.FromPlan(plan)
	if err != nil {
		t.Fatalf("source input from warm plan: %v", err)
	}
	if !staticIndexPrepareFilesContain(sourceInput.Files, sourceFile) {
		t.Fatalf("prepare files = %+v, want cached primary identity", sourceInput.Files)
	}
	if staticIndexPrepareFilesContain(sourceInput.Files, supportFile) {
		t.Fatalf("prepare files = %+v, want no non-parsed support file identity", sourceInput.Files)
	}
	if !staticIndexPrepareFilesContain(sourceInput.PrimaryFiles, sourceFile) {
		t.Fatalf("primary files = %+v, want cached source primary identity", sourceInput.PrimaryFiles)
	}
	if _, ok := sourceInput.SourceTextByFile[sourceFile]; ok {
		t.Fatalf("source text includes cached source file %s, want only filesToParse source text", sourceFile)
	}
	if _, ok := sourceInput.SourceTextByFile[supportFile]; ok {
		t.Fatalf("source text includes support file %s, want no source text for full warm cache hit", supportFile)
	}

	if err := os.WriteFile(supportFile, []byte("export const support = 'changed-support'\n"), 0o600); err != nil {
		t.Fatalf("change support: %v", err)
	}
	dependencyChangedPlan, err := planner.Build(root, "warm-cache", projectindex.ProjectStaticIndexConfig{
		Root:                root,
		StaticSyntaxEnabled: true,
	})
	if err != nil {
		t.Fatalf("dependency changed planner.Build error = %v", err)
	}
	if len(dependencyChangedPlan.CacheHits) != 0 || !slices.Equal(dependencyChangedPlan.CacheMisses, []string{sourceFile}) {
		t.Fatalf("dependency changed cache hits=%v misses=%v, want source miss", dependencyChangedPlan.CacheHits, dependencyChangedPlan.CacheMisses)
	}
	if err := os.WriteFile(supportFile, []byte(supportText), 0o600); err != nil {
		t.Fatalf("restore support: %v", err)
	}

	if err := os.WriteFile(tsconfigFile, []byte("{\"compilerOptions\":{\"module\":\"NodeNext\"}}\n"), 0o600); err != nil {
		t.Fatalf("change tsconfig: %v", err)
	}
	configChangedPlan, err := planner.Build(root, "warm-cache", projectindex.ProjectStaticIndexConfig{
		Root:                root,
		StaticSyntaxEnabled: true,
	})
	if err != nil {
		t.Fatalf("config changed planner.Build error = %v", err)
	}
	if len(configChangedPlan.CacheHits) != 0 || !slices.Equal(configChangedPlan.CacheMisses, []string{sourceFile}) {
		t.Fatalf("config changed cache hits=%v misses=%v, want source miss", configChangedPlan.CacheHits, configChangedPlan.CacheMisses)
	}
	if err := os.WriteFile(tsconfigFile, []byte(tsconfigText), 0o600); err != nil {
		t.Fatalf("restore tsconfig: %v", err)
	}

	if err := os.WriteFile(sourceFile, []byte("import { support } from './support'\nexport const writer = prompt({ id: `${support}:changed` })\n"), 0o600); err != nil {
		t.Fatalf("change source: %v", err)
	}
	changedPlan, err := planner.Build(root, "warm-cache", projectindex.ProjectStaticIndexConfig{
		Root:                root,
		StaticSyntaxEnabled: true,
	})
	if err != nil {
		t.Fatalf("changed planner.Build error = %v", err)
	}
	if len(changedPlan.CacheHits) != 0 {
		t.Fatalf("changed cache hits = %v, want none", changedPlan.CacheHits)
	}
	if !slices.Equal(changedPlan.CacheMisses, []string{sourceFile}) {
		t.Fatalf("changed cache misses = %v, want %v", changedPlan.CacheMisses, []string{sourceFile})
	}
	if !slices.Equal(changedPlan.FilesToParse, []string{supportFile, sourceFile}) {
		t.Fatalf("changed files to parse = %v, want support and source", changedPlan.FilesToParse)
	}
}

func writeStaticIndexPlanCacheFixtureFile(t testing.TB, root, name, source string) string {
	t.Helper()
	file := filepath.Join(root, filepath.FromSlash(name))
	if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
		t.Fatalf("mkdir %s: %v", filepath.Dir(file), err)
	}
	if err := os.WriteFile(file, []byte(source), 0o600); err != nil {
		t.Fatalf("write %s: %v", file, err)
	}
	return file
}

func writeStaticIndexPlanCacheFile(t testing.TB, root, cacheKey string) {
	t.Helper()
	cacheKeyJSON, err := json.Marshal(cacheKey)
	if err != nil {
		t.Fatalf("marshal cache key: %v", err)
	}
	sum := sha256.Sum256(cacheKeyJSON)
	file := filepath.Join(root, ".crux", "cache", "index", cache.Epoch, fmt.Sprintf("%x.json", sum))
	if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
		t.Fatalf("mkdir cache: %v", err)
	}
	if err := os.WriteFile(file, []byte(`{"definitions":[],"relations":[],"dependencies":[],"diagnostics":[]}`), 0o600); err != nil {
		t.Fatalf("write cache file: %v", err)
	}
}

func writeStaticIndexPlanCacheManifest(t testing.TB, root string, entry map[string]any) {
	t.Helper()
	line, err := json.Marshal(entry)
	if err != nil {
		t.Fatalf("marshal manifest entry: %v", err)
	}
	file := filepath.Join(root, ".crux", "cache", "index", cache.Epoch, "manifest.jsonl")
	if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
		t.Fatalf("mkdir manifest: %v", err)
	}
	handle, err := os.OpenFile(file, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		t.Fatalf("open manifest: %v", err)
	}
	defer handle.Close()
	if _, err := handle.Write(append(line, '\n')); err != nil {
		t.Fatalf("write manifest: %v", err)
	}
}

func staticIndexPlanCacheFixtureHash(t testing.TB, file string) string {
	t.Helper()
	source, err := os.ReadFile(file)
	if err != nil {
		t.Fatalf("read %s: %v", file, err)
	}
	sum := sha256.Sum256(source)
	return fmt.Sprintf("%x", sum)
}

func staticIndexPlanCacheCompilerInputsFixture(t testing.TB) []json.RawMessage {
	t.Helper()
	return planner.DefaultCacheCompilerInputs()
}

func staticIndexPlanCacheCompilerInputsWithExtensionFixture(t testing.TB) []json.RawMessage {
	t.Helper()
	inputs := staticIndexPlanCacheCompilerInputsFixture(t)
	inputs = append(inputs, json.RawMessage(`{"kind":"extension","name":"@acme/workflows","version":"top-level"}`))
	return inputs
}

func staticIndexPlanCacheCompilerInputsWithExtensionFixtureJSON(t testing.TB) string {
	t.Helper()
	data, err := json.Marshal(staticIndexPlanCacheCompilerInputsWithExtensionFixture(t))
	if err != nil {
		t.Fatalf("marshal extension compiler inputs fixture: %v", err)
	}
	return string(data)
}
