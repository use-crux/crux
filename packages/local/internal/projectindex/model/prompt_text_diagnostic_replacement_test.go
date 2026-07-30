package model

import (
	"testing"

	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestApplyPatchReplacesPhaseDiagnosticsAndSourceMembership(t *testing.T) {
	t.Parallel()

	const file = "src/prompt.ts"
	state := ApplyPatch(EmptyPatchState(), IndexPatch{
		Phase: PhaseSemantic,
		Facts: IndexPatchFacts{
			Diagnostics: []store.IndexDiagnostic{{
				ID:       "prompt-text:old",
				Severity: "error",
				Code:     "CRUX_PROMPT_TEXT_INVALID_INTERPOLATION",
				Message:  "old",
				Source:   &store.SourceLoc{File: file},
			}},
			Sources: []store.IndexSourceFile{{
				File:        file,
				Status:      "error",
				Diagnostics: []string{"prompt-text:old"},
			}},
		},
	})

	replaced := ApplyPatch(state, IndexPatch{
		Phase:       PhaseSemantic,
		Invalidates: &IndexPatchInvalidation{Files: []string{file}},
		Facts: IndexPatchFacts{
			Diagnostics: []store.IndexDiagnostic{{
				ID:       "prompt-text:new",
				Severity: "error",
				Code:     "CRUX_PROMPT_TEXT_INVALID_INTERPOLATION",
				Message:  "new",
				Source:   &store.SourceLoc{File: file},
			}},
			Sources: []store.IndexSourceFile{{
				File:        file,
				Status:      "error",
				Diagnostics: []string{"prompt-text:new"},
			}},
		},
	})
	if len(replaced.Index.Diagnostics) != 1 ||
		replaced.Index.Diagnostics[0].ID != "prompt-text:new" {
		t.Fatalf("replaced diagnostics = %#v, want only prompt-text:new", replaced.Index.Diagnostics)
	}
	assertSourceDiagnosticIDs(t, replaced.Index.Sources, file, []string{"prompt-text:new"})

	cleared := ApplyPatch(replaced, IndexPatch{
		Phase: PhaseSemantic,
		Facts: IndexPatchFacts{
			Diagnostics: []store.IndexDiagnostic{},
			Sources:     []store.IndexSourceFile{},
		},
	})
	if len(cleared.Index.Diagnostics) != 0 {
		t.Fatalf("cleared diagnostics = %#v, want empty", cleared.Index.Diagnostics)
	}
	assertSourceDiagnosticIDs(t, cleared.Index.Sources, file, nil)
}

func assertSourceDiagnosticIDs(
	t *testing.T,
	sources []store.IndexSourceFile,
	file string,
	want []string,
) {
	t.Helper()
	for _, source := range sources {
		if source.File != file {
			continue
		}
		if len(source.Diagnostics) != len(want) {
			t.Fatalf("source diagnostics = %v, want %v", source.Diagnostics, want)
		}
		for index := range want {
			if source.Diagnostics[index] != want[index] {
				t.Fatalf("source diagnostics = %v, want %v", source.Diagnostics, want)
			}
		}
		return
	}
	t.Fatalf("sources = %#v, want %s", sources, file)
}
