package server

import (
	"context"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/devtools"
)

func TestProjectIndexWorkerNativeStaticMatchesTypeScriptProductionPath(t *testing.T) {
	root := os.Getenv("CRUX_INDEXER_PARITY_ROOT")
	if root == "" {
		t.Skip("set CRUX_INDEXER_PARITY_ROOT to run production static parity")
	}
	if os.Getenv(projectIndexerSyntaxWorkerEnv) == "" {
		t.Skipf("set %s to run production native static parity", projectIndexerSyntaxWorkerEnv)
	}
	if err := os.RemoveAll(filepath.Join(root, ".crux", "cache", "index")); err != nil {
		t.Fatalf("clear index cache: %v", err)
	}

	jsWorker := NewProjectIndexWorker("")
	jsWorker.WithProjectSyntaxWorker(nil)
	defer jsWorker.Close()
	nativeWorker := NewProjectIndexWorker("")
	defer nativeWorker.Close()

	ctx := context.Background()
	jsPatch, err := jsWorker.IndexProjectAstPatch(ctx, root, "", "parity-js")
	if err != nil {
		t.Fatalf("TypeScript IndexProjectAstPatch error = %v", err)
	}
	if err := os.RemoveAll(filepath.Join(root, ".crux", "cache", "index")); err != nil {
		t.Fatalf("clear index cache before native: %v", err)
	}
	nativePatch, err := nativeWorker.IndexProjectAstPatch(ctx, root, "", "parity-native")
	if err != nil {
		t.Fatalf("native IndexProjectAstPatch error = %v", err)
	}

	assertSameIDs(t, "definitions", definitionIDs(jsPatch), definitionIDs(nativePatch))
	assertSameIDs(t, "relations", relationIDs(jsPatch), relationIDs(nativePatch))
	assertSameIDs(t, "diagnostics", diagnosticIDs(jsPatch), diagnosticIDs(nativePatch))
	assertSameIDs(t, "lintFindings", lintFindingIDs(jsPatch), lintFindingIDs(nativePatch))
	assertSameIDs(t, "sourceRefs", sourceRefIDs(jsPatch), sourceRefIDs(nativePatch))
}

func assertSameIDs(t *testing.T, label string, want []string, got []string) {
	t.Helper()
	sort.Strings(want)
	sort.Strings(got)
	if reflect.DeepEqual(want, got) {
		return
	}
	t.Fatalf("%s mismatch\nmissing from native: %v\nextra in native: %v", label, missingIDs(want, got), missingIDs(got, want))
}

func missingIDs(want []string, got []string) []string {
	gotSet := make(map[string]bool, len(got))
	for _, id := range got {
		gotSet[id] = true
	}
	missing := make([]string, 0)
	for _, id := range want {
		if !gotSet[id] {
			missing = append(missing, id)
		}
	}
	return missing
}

func definitionIDs(patch devtools.IndexPatch) []string {
	ids := make([]string, 0, len(patch.Facts.Definitions))
	for _, definition := range patch.Facts.Definitions {
		ids = append(ids, definition.ID)
	}
	return ids
}

func relationIDs(patch devtools.IndexPatch) []string {
	ids := make([]string, 0, len(patch.Facts.Relations))
	for _, relation := range patch.Facts.Relations {
		ids = append(ids, relation.ID)
	}
	return ids
}

func diagnosticIDs(patch devtools.IndexPatch) []string {
	ids := make([]string, 0, len(patch.Facts.Diagnostics))
	for _, diagnostic := range patch.Facts.Diagnostics {
		ids = append(ids, diagnostic.ID)
	}
	return ids
}

func lintFindingIDs(patch devtools.IndexPatch) []string {
	ids := make([]string, 0, len(patch.Facts.LintFindings))
	for _, finding := range patch.Facts.LintFindings {
		ids = append(ids, finding.ID)
	}
	return ids
}

func sourceRefIDs(patch devtools.IndexPatch) []string {
	ids := make([]string, 0, len(patch.Facts.SourceRefs))
	for _, ref := range patch.Facts.SourceRefs {
		ids = append(ids, ref.DefinitionID+"/"+ref.Ref.ID)
	}
	return ids
}
