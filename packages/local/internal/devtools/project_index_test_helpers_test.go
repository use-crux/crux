package devtools

import (
	"testing"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func indexPatchFromSnapshot(index store.IndexData, phase projectindex.IndexPatchPhase, status string) projectindex.IndexPatch {
	return projectindex.PatchFromSnapshot(index, phase, status)
}

func indexFactTransactionFromPatch(patch projectindex.IndexPatch) projectindex.IndexFactTransaction {
	return projectindex.FactTransactionFromPatch(patch)
}

func findTestLintFinding(findings []store.IndexLintFinding, id string) *store.IndexLintFinding {
	for i := range findings {
		if findings[i].ID == id {
			return &findings[i]
		}
	}
	return nil
}

func assertStringSet(t *testing.T, actual []string, expected []string) {
	t.Helper()
	if len(actual) != len(expected) {
		t.Fatalf("values = %v, want %v", actual, expected)
	}
	seen := map[string]bool{}
	for _, value := range actual {
		seen[value] = true
	}
	for _, value := range expected {
		if !seen[value] {
			t.Fatalf("values = %v, want %v", actual, expected)
		}
	}
}
