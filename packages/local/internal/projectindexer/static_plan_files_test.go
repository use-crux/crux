package projectindexer

import (
	"bytes"
	"os"
	"slices"
	"strings"
	"testing"
	"time"
)

func TestProjectNativeStaticFileSelectionIgnoresEmbeddedBuildArtifacts(t *testing.T) {
	root := t.TempDir()
	authored := fileWithNativeStaticSource(t, root, "packages/core/src/writer.ts")
	embedded := fileWithNativeStaticSource(t, root, "packages/local/internal/server/embed/project-indexer.mjs")
	uiEmbedded := fileWithNativeStaticSource(t, root, "packages/local/internal/server/ui-embed/assets/app.js")

	selection, err := projectNativeStaticFileSelection(root, "")
	if err != nil {
		t.Fatalf("projectNativeStaticFileSelection error = %v", err)
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
	for _, skipped := range selection.Skipped {
		if bytes.Contains(skipped, []byte("server/embed")) ||
			bytes.Contains(skipped, []byte("server/ui-embed")) {
			t.Fatalf("skipped files included embedded build artifact: %s", skipped)
		}
	}
}

func TestProjectNativeStaticFileSelectionOnlyClassifiesStaticSourceCandidates(t *testing.T) {
	root := t.TempDir()
	authored := fileWithNativeStaticSource(t, root, "src/writer.ts")
	unsupported := writeNativeStaticPlanCacheFixtureFile(t, root, "README.md", "prompt({ id: 'docs' })\n")
	rootFixture := writeNativeStaticPlanCacheFixtureFile(t, root, "__fixtures__/fixture.ts", "export const fixture = prompt({ id: 'fixture' })\n")
	rootTest := writeNativeStaticPlanCacheFixtureFile(t, root, "__tests__/fixture.ts", "export const fixture = prompt({ id: 'test' })\n")
	nestedCache := writeNativeStaticPlanCacheFixtureFile(t, root, "packages/app/.crux/cache/index/static.ts", "export const cached = prompt({ id: 'cache' })\n")

	selection, err := projectNativeStaticFileSelection(root, "")
	if err != nil {
		t.Fatalf("projectNativeStaticFileSelection error = %v", err)
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
	for _, skipped := range selection.Skipped {
		if bytes.Contains(skipped, []byte("README.md")) {
			t.Fatalf("skipped files included unsupported non-source candidate: %s", skipped)
		}
	}
}

func TestProjectNativeStaticSupportFilesIncludesRecursiveLocalImports(t *testing.T) {
	root := t.TempDir()
	primary := writeNativeStaticPlanCacheFixtureFile(t, root, "src/primary.ts", "import './helpers/one'\nexport const writer = prompt({ id: 'writer' })\n")
	helper := writeNativeStaticPlanCacheFixtureFile(t, root, "src/helpers/one.ts", "export { value } from './two'\n")
	nested := writeNativeStaticPlanCacheFixtureFile(t, root, "src/helpers/two.ts", "export const value = 'two'\n")

	support := projectNativeStaticSupportFiles([]string{primary})
	for _, file := range []string{helper, nested} {
		if !slices.Contains(support, file) {
			t.Fatalf("support files = %v, want %s", support, file)
		}
	}
}

func TestProjectNativeStaticFileSelectionReusesDiscoveryCacheForUnchangedSources(t *testing.T) {
	root := t.TempDir()
	primary := writeNativeStaticPlanCacheFixtureFile(t, root, "src/primary.ts", "import './helper'\nexport const writer = prompt({ id: 'writer' })\n")
	helper := writeNativeStaticPlanCacheFixtureFile(t, root, "src/helper.ts", "export const helper = 'cached'\n")

	first, err := projectNativeStaticFileSelection(root, "")
	if err != nil {
		t.Fatalf("first projectNativeStaticFileSelection error = %v", err)
	}
	if !slices.Contains(first.PrimaryFiles, primary) || !slices.Contains(first.Files, helper) {
		t.Fatalf("first selection primary=%v files=%v, want primary and helper", first.PrimaryFiles, first.Files)
	}

	second, err := projectNativeStaticFileSelection(root, "")
	if err != nil {
		t.Fatalf("second projectNativeStaticFileSelection error = %v", err)
	}
	if !slices.Contains(second.PrimaryFiles, primary) {
		t.Fatalf("second primary files = %v, want cached primary %s", second.PrimaryFiles, primary)
	}
	if !slices.Contains(second.Files, helper) {
		t.Fatalf("second files = %v, want cached support %s", second.Files, helper)
	}
}

func TestProjectNativeStaticDiscoveryCacheInvalidatesByCallNamesAndSourceFingerprint(t *testing.T) {
	root := t.TempDir()
	workflow := writeNativeStaticPlanCacheFixtureFile(t, root, "src/workflow.ts", "export const wf = defineWorkflow({ id: 'wf' })\n")
	latePrompt := writeNativeStaticPlanCacheFixtureFile(t, root, "src/late-prompt.ts", "export const value = 'plain'\n")

	defaultSelection, err := projectNativeStaticFileSelection(root, "")
	if err != nil {
		t.Fatalf("default projectNativeStaticFileSelection error = %v", err)
	}
	if slices.Contains(defaultSelection.PrimaryFiles, workflow) {
		t.Fatalf("default primary files = %v, want no extension-only workflow", defaultSelection.PrimaryFiles)
	}
	if slices.Contains(defaultSelection.PrimaryFiles, latePrompt) {
		t.Fatalf("default primary files = %v, want no plain source", defaultSelection.PrimaryFiles)
	}

	advanceFileContents(t, latePrompt, "export const writer = prompt({ id: 'late' })\n")
	lateSelection, err := projectNativeStaticFileSelection(root, "")
	if err != nil {
		t.Fatalf("late projectNativeStaticFileSelection error = %v", err)
	}
	if !slices.Contains(lateSelection.PrimaryFiles, latePrompt) {
		t.Fatalf("late primary files = %v, want source fingerprint invalidation to add prompt", lateSelection.PrimaryFiles)
	}

	extensionSelection, err := projectNativeStaticFileSelectionWithCallNames(root, "", []string{"defineWorkflow"})
	if err != nil {
		t.Fatalf("extension projectNativeStaticFileSelection error = %v", err)
	}
	if !slices.Contains(extensionSelection.PrimaryFiles, workflow) {
		t.Fatalf("extension primary files = %v, want workflow after call-name change", extensionSelection.PrimaryFiles)
	}

	advanceFileContents(t, workflow, "export const wf = 'not static anymore'\n")
	changedSelection, err := projectNativeStaticFileSelectionWithCallNames(root, "", []string{"defineWorkflow"})
	if err != nil {
		t.Fatalf("changed projectNativeStaticFileSelection error = %v", err)
	}
	if slices.Contains(changedSelection.PrimaryFiles, workflow) {
		t.Fatalf("changed primary files = %v, want source fingerprint invalidation", changedSelection.PrimaryFiles)
	}
}

func TestProjectNativeStaticDiscoveryCacheInvalidatesSameSizeSameModTimeSourceRewrite(t *testing.T) {
	root := t.TempDir()
	latePrompt := writeNativeStaticPlanCacheFixtureFile(t, root, "src/late-prompt.ts",
		"export const value = 'plain source without crux signals here'\n",
	)

	defaultSelection, err := projectNativeStaticFileSelection(root, "")
	if err != nil {
		t.Fatalf("default projectNativeStaticFileSelection error = %v", err)
	}
	if slices.Contains(defaultSelection.PrimaryFiles, latePrompt) {
		t.Fatalf("default primary files = %v, want no plain source", defaultSelection.PrimaryFiles)
	}

	replaceFileContentsPreservingSizeAndModTime(t, latePrompt, "export const writer = prompt({ id: 'late' })\n")
	changedSelection, err := projectNativeStaticFileSelection(root, "")
	if err != nil {
		t.Fatalf("changed projectNativeStaticFileSelection error = %v", err)
	}
	if !slices.Contains(changedSelection.PrimaryFiles, latePrompt) {
		t.Fatalf("changed primary files = %v, want change-time invalidation to add prompt", changedSelection.PrimaryFiles)
	}
}

func TestProjectNativeStaticSupportDiscoveryCacheInvalidatesWhenImportTargetAppears(t *testing.T) {
	root := t.TempDir()
	primary := writeNativeStaticPlanCacheFixtureFile(t, root, "src/primary.ts", "import './late-helper'\nexport const writer = prompt({ id: 'writer' })\n")

	first, err := projectNativeStaticFileSelection(root, "")
	if err != nil {
		t.Fatalf("first projectNativeStaticFileSelection error = %v", err)
	}
	if len(first.Files) != 1 || !slices.Contains(first.Files, primary) {
		t.Fatalf("first files = %v, want only primary before helper exists", first.Files)
	}

	helper := writeNativeStaticPlanCacheFixtureFile(t, root, "src/late-helper.ts", "export const late = 'helper'\n")
	advanceFileModTime(t, helper)
	second, err := projectNativeStaticFileSelection(root, "")
	if err != nil {
		t.Fatalf("second projectNativeStaticFileSelection error = %v", err)
	}
	if !slices.Contains(second.Files, helper) {
		t.Fatalf("second files = %v, want helper after import resolution invalidation", second.Files)
	}

	nested := writeNativeStaticPlanCacheFixtureFile(t, root, "src/nested.ts", "export const nested = 'helper'\n")
	advanceFileContents(t, helper, "export { nested } from './nested'\n")
	third, err := projectNativeStaticFileSelection(root, "")
	if err != nil {
		t.Fatalf("third projectNativeStaticFileSelection error = %v", err)
	}
	if !slices.Contains(third.Files, nested) {
		t.Fatalf("third files = %v, want nested helper after support import edit", third.Files)
	}
}

func TestProjectNativeStaticSupportDiscoveryCacheInvalidatesSameSizeSameModTimeImportRewrite(t *testing.T) {
	root := t.TempDir()
	primary := writeNativeStaticPlanCacheFixtureFile(t, root, "src/primary.ts", "import './one'\nexport const writer = prompt({ id: 'writer' })\n")
	one := writeNativeStaticPlanCacheFixtureFile(t, root, "src/one.ts", "export const one = 'helper'\n")
	two := writeNativeStaticPlanCacheFixtureFile(t, root, "src/two.ts", "export const two = 'helper'\n")

	first, err := projectNativeStaticFileSelection(root, "")
	if err != nil {
		t.Fatalf("first projectNativeStaticFileSelection error = %v", err)
	}
	if !slices.Contains(first.Files, one) || slices.Contains(first.Files, two) {
		t.Fatalf("first files = %v, want import target one only", first.Files)
	}

	replaceFileContentsPreservingSizeAndModTime(t, primary, "import './two'\nexport const writer = prompt({ id: 'writer' })\n")
	second, err := projectNativeStaticFileSelection(root, "")
	if err != nil {
		t.Fatalf("second projectNativeStaticFileSelection error = %v", err)
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
