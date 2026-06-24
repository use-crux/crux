package indexhost

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/indexhost/native/sourceprofile"
	"github.com/use-crux/crux/packages/local/internal/indexhost/native/staticcache"
	"github.com/use-crux/crux/packages/local/internal/indexhost/native/staticplan/plan"
)

func TestProjectNativeStaticSyntaxPlanUsesWarmStaticCacheManifest(t *testing.T) {
	t.Setenv(staticcache.StatusEnv, "1")

	root := t.TempDir()
	sourceText := "import { support } from './support'\nexport const writer = prompt({ id: support })\n"
	supportText := "export const support = 'warm-cache'\n"
	tsconfigText := "{\"compilerOptions\":{\"module\":\"ESNext\"}}\n"
	sourceFile := writeNativeStaticPlanCacheFixtureFile(t, root, "src/writer.ts",
		sourceText)
	supportFile := writeNativeStaticPlanCacheFixtureFile(t, root, "src/support.ts",
		supportText)
	tsconfigFile := writeNativeStaticPlanCacheFixtureFile(t, root, "tsconfig.json",
		tsconfigText)

	cacheKey := "static-cache-key:writer"
	writeNativeStaticPlanCacheFile(t, root, cacheKey)
	writeNativeStaticPlanCacheManifest(t, root, map[string]any{
		"version":    "static-parse-v38",
		"root":       root,
		"file":       "src/writer.ts",
		"sourceHash": nativeStaticPlanCacheFixtureHash(t, sourceFile),
		"dependencies": []map[string]string{{
			"file":       "src/support.ts",
			"sourceHash": nativeStaticPlanCacheFixtureHash(t, supportFile),
		}},
		"configFiles": []map[string]string{{
			"file":       "tsconfig.json",
			"sourceHash": nativeStaticPlanCacheFixtureHash(t, tsconfigFile),
		}},
		"compilerInputs": nativeStaticPlanCacheCompilerInputsFixture(t),
		"cacheKey":       cacheKey,
	})

	plan, err := staticplan.Build(root, "warm-cache", projectindex.ProjectNativeStaticConfig{
		Root:             root,
		NativeAstEnabled: true,
	})
	if err != nil {
		t.Fatalf("staticplan.Build error = %v", err)
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
	if !nativeStaticPrepareFilesContain(sourceInput.Files, sourceFile) {
		t.Fatalf("prepare files = %+v, want cached primary identity", sourceInput.Files)
	}
	if nativeStaticPrepareFilesContain(sourceInput.Files, supportFile) {
		t.Fatalf("prepare files = %+v, want no non-parsed support file identity", sourceInput.Files)
	}
	if !nativeStaticPrepareFilesContain(sourceInput.PrimaryFiles, sourceFile) {
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
	dependencyChangedPlan, err := staticplan.Build(root, "warm-cache", projectindex.ProjectNativeStaticConfig{
		Root:             root,
		NativeAstEnabled: true,
	})
	if err != nil {
		t.Fatalf("dependency changed staticplan.Build error = %v", err)
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
	configChangedPlan, err := staticplan.Build(root, "warm-cache", projectindex.ProjectNativeStaticConfig{
		Root:             root,
		NativeAstEnabled: true,
	})
	if err != nil {
		t.Fatalf("config changed staticplan.Build error = %v", err)
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
	changedPlan, err := staticplan.Build(root, "warm-cache", projectindex.ProjectNativeStaticConfig{
		Root:             root,
		NativeAstEnabled: true,
	})
	if err != nil {
		t.Fatalf("changed staticplan.Build error = %v", err)
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

func writeNativeStaticPlanCacheFixtureFile(t testing.TB, root, name, source string) string {
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

func writeNativeStaticPlanCacheFile(t testing.TB, root, cacheKey string) {
	t.Helper()
	cacheKeyJSON, err := json.Marshal(cacheKey)
	if err != nil {
		t.Fatalf("marshal cache key: %v", err)
	}
	sum := sha256.Sum256(cacheKeyJSON)
	file := filepath.Join(root, ".crux", "cache", "index", "static-parse-v38", fmt.Sprintf("%x.json", sum))
	if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
		t.Fatalf("mkdir cache: %v", err)
	}
	if err := os.WriteFile(file, []byte(`{"definitions":[],"relations":[],"dependencies":[],"diagnostics":[]}`), 0o600); err != nil {
		t.Fatalf("write cache file: %v", err)
	}
}

func writeNativeStaticPlanCacheManifest(t testing.TB, root string, entry map[string]any) {
	t.Helper()
	line, err := json.Marshal(entry)
	if err != nil {
		t.Fatalf("marshal manifest entry: %v", err)
	}
	file := filepath.Join(root, ".crux", "cache", "index", "static-parse-v38", "manifest.jsonl")
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

func nativeStaticPlanCacheFixtureHash(t testing.TB, file string) string {
	t.Helper()
	source, err := os.ReadFile(file)
	if err != nil {
		t.Fatalf("read %s: %v", file, err)
	}
	sum := sha256.Sum256(source)
	return fmt.Sprintf("%x", sum)
}

func nativeStaticPlanCacheCompilerInputsFixture(t testing.TB) []json.RawMessage {
	t.Helper()
	raw := `[{"kind":"compiler-profile","name":"@crux/indexer/crux-core-profile","version":"1"},{"kind":"compiler-projection","name":"prompt-context-tree-paths","version":"1","phase":"resolve"},{"kind":"compiler-projection","name":"runtime-prepare-use-entries","version":"1","phase":"parse"},{"kind":"compiler-projection","name":"source-ref-projection","version":"1","phase":"parse"},{"kind":"extension-manifest","name":"@crux/indexer/crux-core","version":"1","digest":"9c3b36a0826e4861a68247126a241017715048d9fef28b6649808f17ace3ba71"},{"kind":"extension","name":"@crux/indexer/crux-core","version":"1"},{"kind":"extractor","extension":"@crux/indexer/crux-core","name":"agent"},{"kind":"extractor","extension":"@crux/indexer/crux-core","name":"blackboard"},{"kind":"extractor","extension":"@crux/indexer/crux-core","name":"composition"},{"kind":"extractor","extension":"@crux/indexer/crux-core","name":"context"},{"kind":"extractor","extension":"@crux/indexer/crux-core","name":"eval"},{"kind":"extractor","extension":"@crux/indexer/crux-core","name":"flow"},{"kind":"extractor","extension":"@crux/indexer/crux-core","name":"injectable"},{"kind":"extractor","extension":"@crux/indexer/crux-core","name":"memory"},{"kind":"extractor","extension":"@crux/indexer/crux-core","name":"prompt"},{"kind":"extractor","extension":"@crux/indexer/crux-core","name":"rag.retriever"},{"kind":"extractor","extension":"@crux/indexer/crux-core","name":"registry-skill"},{"kind":"extractor","extension":"@crux/indexer/crux-core","name":"routing"},{"kind":"extractor","extension":"@crux/indexer/crux-core","name":"safety"},{"kind":"extractor","extension":"@crux/indexer/crux-core","name":"scorer"},{"kind":"extractor","extension":"@crux/indexer/crux-core","name":"skill-registry"},{"kind":"extractor","extension":"@crux/indexer/crux-core","name":"tool"},{"kind":"extractor","extension":"@crux/indexer/crux-core","name":"workspace"},{"kind":"native-primitive-manifest","name":"crux-native-static-host","version":"1","digest":"ebb0991b34c19eef6a5a035a4124f266e2cc7c41d4526cfe4a8e0d018c5ec577"},{"kind":"relation-policy","name":"runtime-relation-specs","digest":"0aa11aad16e45c4064273c1e406633efed30801f98f1e2f609c4191ecf21f7ed"},{"kind":"static-evidence-manifest","name":"runtime-static-interests","digest":"56da88dcef8a7fd7805bacf329632f17cd43d46d792216fe5522e2550f60b2a2"},{"kind":"syntax-frontend","name":"oxc-rust","version":"oxc_parser@0.133.0+crux_native_group3.5"}]`
	var inputs []json.RawMessage
	if err := json.Unmarshal([]byte(raw), &inputs); err != nil {
		t.Fatalf("decode compiler inputs fixture: %v", err)
	}
	return inputs
}

func nativeStaticPlanCacheCompilerInputsWithExtensionFixture(t testing.TB) []json.RawMessage {
	t.Helper()
	inputs := nativeStaticPlanCacheCompilerInputsFixture(t)
	inputs = append(inputs, json.RawMessage(`{"kind":"extension","name":"@acme/workflows","version":"top-level"}`))
	return inputs
}

func nativeStaticPlanCacheCompilerInputsWithExtensionFixtureJSON(t testing.TB) string {
	t.Helper()
	data, err := json.Marshal(nativeStaticPlanCacheCompilerInputsWithExtensionFixture(t))
	if err != nil {
		t.Fatalf("marshal extension compiler inputs fixture: %v", err)
	}
	return string(data)
}
