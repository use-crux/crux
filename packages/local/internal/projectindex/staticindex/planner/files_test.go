package planner

import (
	"bytes"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"
)

func fileWithStaticIndexSource(t testing.TB, root string, name string) string {
	t.Helper()
	return writeStaticIndexPlanCacheFixtureFile(t, root, name, "export const writer = prompt({ id: 'writer' })\n")
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

func TestProjectStaticIndexFileSelectionIgnoresEmbeddedBuildArtifacts(t *testing.T) {
	root := t.TempDir()
	authored := fileWithStaticIndexSource(t, root, "packages/core/src/writer.ts")
	embedded := fileWithStaticIndexSource(t, root, "packages/local/internal/assets/embed/project-indexer.mjs")
	uiEmbedded := fileWithStaticIndexSource(t, root, "packages/local/internal/assets/ui-embed/assets/app.js")
	legacyServerEmbedded := fileWithStaticIndexSource(t, root, "packages/local/internal/server/embed/project-indexer.mjs")
	legacyServerUIEmbedded := fileWithStaticIndexSource(t, root, "packages/local/internal/server/ui-embed/assets/app.js")

	selection, err := fileSelection(root, "")
	if err != nil {
		t.Fatalf("fileSelection error = %v", err)
	}
	if !slices.Contains(selection.PrimaryFiles, authored) {
		t.Fatalf("primary files = %v, want authored source %s", selection.PrimaryFiles, authored)
	}
	if slices.Contains(selection.PrimaryFiles, embedded) {
		t.Fatalf("primary files included embedded build artifact %s", embedded)
	}
	if slices.Contains(selection.PrimaryFiles, uiEmbedded) {
		t.Fatalf("primary files included UI embedded build artifact %s", uiEmbedded)
	}
	if !slices.Contains(selection.PrimaryFiles, legacyServerEmbedded) {
		t.Fatalf("primary files = %v, want legacy server embed path treated as ordinary source %s", selection.PrimaryFiles, legacyServerEmbedded)
	}
	if !slices.Contains(selection.PrimaryFiles, legacyServerUIEmbedded) {
		t.Fatalf("primary files = %v, want legacy server UI embed path treated as ordinary source %s", selection.PrimaryFiles, legacyServerUIEmbedded)
	}
	for _, skipped := range selection.Skipped {
		if bytes.Contains(skipped, []byte("assets/embed")) ||
			bytes.Contains(skipped, []byte("assets/ui-embed")) {
			t.Fatalf("skipped files included embedded build artifact: %s", skipped)
		}
	}
}

func TestProjectStaticIndexFileSelectionOnlyClassifiesStaticSourceCandidates(t *testing.T) {
	root := t.TempDir()
	authored := fileWithStaticIndexSource(t, root, "src/writer.ts")
	unsupported := writeStaticIndexPlanCacheFixtureFile(t, root, "README.md", "prompt({ id: 'docs' })\n")
	rootFixture := writeStaticIndexPlanCacheFixtureFile(t, root, "__fixtures__/fixture.ts", "export const fixture = prompt({ id: 'fixture' })\n")
	rootTest := writeStaticIndexPlanCacheFixtureFile(t, root, "__tests__/fixture.ts", "export const fixture = prompt({ id: 'test' })\n")
	nestedCache := writeStaticIndexPlanCacheFixtureFile(t, root, "packages/app/.crux/cache/index/static.ts", "export const cached = prompt({ id: 'cache' })\n")
	tempBuild := writeStaticIndexPlanCacheFixtureFile(t, root, ".tmp/npm-build/ts/packages/core/writer.js", "export const writer = prompt({ id: 'tmp' })\n")
	selection, err := fileSelection(root, "")
	if err != nil {
		t.Fatalf("fileSelection error = %v", err)
	}
	if !slices.Contains(selection.PrimaryFiles, authored) {
		t.Fatalf("primary files = %v, want authored source %s", selection.PrimaryFiles, authored)
	}
	if slices.Contains(selection.PrimaryFiles, unsupported) {
		t.Fatalf("primary files included unsupported file %s", unsupported)
	}
	if slices.Contains(selection.PrimaryFiles, rootFixture) {
		t.Fatalf("primary files included root fixture file %s", rootFixture)
	}
	if slices.Contains(selection.PrimaryFiles, rootTest) {
		t.Fatalf("primary files included root test file %s", rootTest)
	}
	if slices.Contains(selection.PrimaryFiles, nestedCache) {
		t.Fatalf("primary files included nested cache file %s", nestedCache)
	}
	if slices.Contains(selection.PrimaryFiles, tempBuild) {
		t.Fatalf("primary files included temporary build output %s", tempBuild)
	}
	for _, skipped := range selection.Skipped {
		if bytes.Contains(skipped, []byte("README.md")) {
			t.Fatalf("skipped files included unsupported non-source candidate: %s", skipped)
		}
	}
}

func TestProjectStaticIndexSupportFilesIncludesRecursiveLocalImports(t *testing.T) {
	root := t.TempDir()
	primary := writeStaticIndexPlanCacheFixtureFile(t, root, "src/primary.ts", "import './helpers/one'\nexport const writer = prompt({ id: 'writer' })\n")
	helper := writeStaticIndexPlanCacheFixtureFile(t, root, "src/helpers/one.ts", "export { value } from './two'\n")
	nested := writeStaticIndexPlanCacheFixtureFile(t, root, "src/helpers/two.ts", "export const value = 'two'\n")

	support := supportFiles([]string{primary})
	for _, file := range []string{helper, nested} {
		if !slices.Contains(support, file) {
			t.Fatalf("support files = %v, want %s", support, file)
		}
	}
}

func TestProjectStaticIndexFileSelectionReusesDiscoveryCacheForUnchangedSources(t *testing.T) {
	root := t.TempDir()
	primary := writeStaticIndexPlanCacheFixtureFile(t, root, "src/primary.ts", "import './helper'\nexport const writer = prompt({ id: 'writer' })\n")
	helper := writeStaticIndexPlanCacheFixtureFile(t, root, "src/helper.ts", "export const helper = 'cached'\n")

	first, err := fileSelection(root, "")
	if err != nil {
		t.Fatalf("first fileSelection error = %v", err)
	}
	if !slices.Contains(first.PrimaryFiles, primary) || !slices.Contains(first.Files, helper) {
		t.Fatalf("first selection primary=%v files=%v, want primary and helper", first.PrimaryFiles, first.Files)
	}

	second, err := fileSelection(root, "")
	if err != nil {
		t.Fatalf("second fileSelection error = %v", err)
	}
	if !slices.Contains(second.PrimaryFiles, primary) {
		t.Fatalf("second primary files = %v, want cached primary %s", second.PrimaryFiles, primary)
	}
	if !slices.Contains(second.Files, helper) {
		t.Fatalf("second files = %v, want cached support %s", second.Files, helper)
	}
}

func TestProjectStaticIndexDiscoveryCacheInvalidatesByCallNamesAndSourceFingerprint(t *testing.T) {
	root := t.TempDir()
	workflow := writeStaticIndexPlanCacheFixtureFile(t, root, "src/workflow.ts", "export const wf = defineWorkflow({ id: 'wf' })\n")
	latePrompt := writeStaticIndexPlanCacheFixtureFile(t, root, "src/late-prompt.ts", "export const value = 'plain'\n")

	defaultSelection, err := fileSelection(root, "")
	if err != nil {
		t.Fatalf("default fileSelection error = %v", err)
	}
	if slices.Contains(defaultSelection.PrimaryFiles, workflow) {
		t.Fatalf("default primary files = %v, want no extension-only workflow", defaultSelection.PrimaryFiles)
	}
	if slices.Contains(defaultSelection.PrimaryFiles, latePrompt) {
		t.Fatalf("default primary files = %v, want no plain source", defaultSelection.PrimaryFiles)
	}

	advanceFileContents(t, latePrompt, "export const writer = prompt({ id: 'late' })\n")
	lateSelection, err := fileSelection(root, "")
	if err != nil {
		t.Fatalf("late fileSelection error = %v", err)
	}
	if !slices.Contains(lateSelection.PrimaryFiles, latePrompt) {
		t.Fatalf("late primary files = %v, want source fingerprint invalidation to add prompt", lateSelection.PrimaryFiles)
	}

	extensionSelection, err := fileSelectionWithCallNames(root, "", []string{"defineWorkflow"})
	if err != nil {
		t.Fatalf("extension fileSelection error = %v", err)
	}
	if !slices.Contains(extensionSelection.PrimaryFiles, workflow) {
		t.Fatalf("extension primary files = %v, want workflow after call-name change", extensionSelection.PrimaryFiles)
	}

	advanceFileContents(t, workflow, "export const wf = 'not static anymore'\n")
	changedSelection, err := fileSelectionWithCallNames(root, "", []string{"defineWorkflow"})
	if err != nil {
		t.Fatalf("changed fileSelection error = %v", err)
	}
	if slices.Contains(changedSelection.PrimaryFiles, workflow) {
		t.Fatalf("changed primary files = %v, want source fingerprint invalidation", changedSelection.PrimaryFiles)
	}
}

func TestProjectStaticIndexDiscoveryCacheInvalidatesSameSizeSameModTimeSourceRewrite(t *testing.T) {
	root := t.TempDir()
	latePrompt := writeStaticIndexPlanCacheFixtureFile(t, root, "src/late-prompt.ts",
		"export const value = 'plain source without crux signals here'\n",
	)

	defaultSelection, err := fileSelection(root, "")
	if err != nil {
		t.Fatalf("default fileSelection error = %v", err)
	}
	if slices.Contains(defaultSelection.PrimaryFiles, latePrompt) {
		t.Fatalf("default primary files = %v, want no plain source", defaultSelection.PrimaryFiles)
	}

	replaceFileContentsPreservingSizeAndModTime(t, latePrompt, "export const writer = prompt({ id: 'late' })\n")
	changedSelection, err := fileSelection(root, "")
	if err != nil {
		t.Fatalf("changed fileSelection error = %v", err)
	}
	if !slices.Contains(changedSelection.PrimaryFiles, latePrompt) {
		t.Fatalf("changed primary files = %v, want change-time invalidation to add prompt", changedSelection.PrimaryFiles)
	}
}

func TestProjectStaticIndexSupportDiscoveryCacheInvalidatesWhenImportTargetAppears(t *testing.T) {
	root := t.TempDir()
	primary := writeStaticIndexPlanCacheFixtureFile(t, root, "src/primary.ts", "import './late-helper'\nexport const writer = prompt({ id: 'writer' })\n")

	first, err := fileSelection(root, "")
	if err != nil {
		t.Fatalf("first fileSelection error = %v", err)
	}
	if len(first.Files) != 1 || !slices.Contains(first.Files, primary) {
		t.Fatalf("first files = %v, want only primary before helper exists", first.Files)
	}

	helper := writeStaticIndexPlanCacheFixtureFile(t, root, "src/late-helper.ts", "export const late = 'helper'\n")
	advanceFileModTime(t, helper)
	second, err := fileSelection(root, "")
	if err != nil {
		t.Fatalf("second fileSelection error = %v", err)
	}
	if !slices.Contains(second.Files, helper) {
		t.Fatalf("second files = %v, want helper after import resolution invalidation", second.Files)
	}

	nested := writeStaticIndexPlanCacheFixtureFile(t, root, "src/nested.ts", "export const nested = 'helper'\n")
	advanceFileContents(t, helper, "export { nested } from './nested'\n")
	third, err := fileSelection(root, "")
	if err != nil {
		t.Fatalf("third fileSelection error = %v", err)
	}
	if !slices.Contains(third.Files, nested) {
		t.Fatalf("third files = %v, want nested helper after support import edit", third.Files)
	}
}

func TestProjectStaticIndexSupportDiscoveryCacheInvalidatesSameSizeSameModTimeImportRewrite(t *testing.T) {
	root := t.TempDir()
	primary := writeStaticIndexPlanCacheFixtureFile(t, root, "src/primary.ts", "import './one'\nexport const writer = prompt({ id: 'writer' })\n")
	one := writeStaticIndexPlanCacheFixtureFile(t, root, "src/one.ts", "export const one = 'helper'\n")
	two := writeStaticIndexPlanCacheFixtureFile(t, root, "src/two.ts", "export const two = 'helper'\n")

	first, err := fileSelection(root, "")
	if err != nil {
		t.Fatalf("first fileSelection error = %v", err)
	}
	if !slices.Contains(first.Files, one) || slices.Contains(first.Files, two) {
		t.Fatalf("first files = %v, want import target one only", first.Files)
	}

	replaceFileContentsPreservingSizeAndModTime(t, primary, "import './two'\nexport const writer = prompt({ id: 'writer' })\n")
	second, err := fileSelection(root, "")
	if err != nil {
		t.Fatalf("second fileSelection error = %v", err)
	}
	if slices.Contains(second.Files, one) || !slices.Contains(second.Files, two) {
		t.Fatalf("second files = %v, want change-time invalidation to select target two only", second.Files)
	}
}

func replaceFileContentsPreservingSizeAndModTime(t testing.TB, file string, source string) {
	t.Helper()
	info, err := os.Stat(file)
	if err != nil {
		t.Fatalf("stat %s: %v", file, err)
	}
	if len(source) > int(info.Size()) {
		t.Fatalf("replacement source for %s has %d bytes, want at most %d", file, len(source), info.Size())
	}
	padded := source + strings.Repeat(" ", int(info.Size())-len(source))
	if err := os.WriteFile(file, []byte(padded), 0o600); err != nil {
		t.Fatalf("write same-size %s: %v", file, err)
	}
	if err := os.Chtimes(file, info.ModTime(), info.ModTime()); err != nil {
		t.Fatalf("restore modtime %s: %v", file, err)
	}
}

func advanceFileContents(t testing.TB, file string, source string) {
	t.Helper()
	if err := os.Chmod(file, 0o600); err != nil {
		t.Fatalf("chmod writable %s: %v", file, err)
	}
	if err := os.WriteFile(file, []byte(source), 0o600); err != nil {
		t.Fatalf("write %s: %v", file, err)
	}
	advanceFileModTime(t, file)
}

func advanceFileModTime(t testing.TB, file string) {
	t.Helper()
	next := time.Now().Add(2 * time.Second)
	if err := os.Chtimes(file, next, next); err != nil {
		t.Fatalf("chtimes %s: %v", file, err)
	}
}
