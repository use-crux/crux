package server

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestIndexDeltaMessageIncludesLintReplacement(t *testing.T) {
	t.Parallel()

	const file = "src/writer.ts"
	current := store.IndexData{
		Sources: []store.IndexSourceFile{{File: file, Status: "indexed"}},
		LintFindings: []store.IndexLintFinding{{
			ID:         "lint:prompt.missing_input_schema:prompt:writer",
			Severity:   "info",
			RuleID:     "prompt.missing_input_schema",
			Category:   "contracts",
			Maturity:   "stable",
			Confidence: "high",
			Profiles:   []string{"recommended", "strict"},
			Title:      "Prompt has no input schema",
			Message:    "Prompt writer does not expose an input schema.",
			Rationale:  "Prompt inputs should be inspectable.",
			Source:     &store.SourceLoc{File: file, Line: 3},
			Evidence:   []store.IndexLintEvidence{},
			Fixes:      []store.IndexLintFix{},
		}},
	}

	messages := indexDeltaMessages(store.IndexData{}, current, 7)
	if len(messages) != 1 {
		t.Fatalf("delta count = %d, want 1", len(messages))
	}
	got, err := json.MarshalIndent(messages[0], "", "  ")
	if err != nil {
		t.Fatalf("marshal delta: %v", err)
	}
	got = append(got, '\n')
	want, err := os.ReadFile(filepath.Join("testdata", "index-delta-with-lints.golden.json"))
	if err != nil {
		t.Fatalf("read golden: %v", err)
	}
	if !bytes.Equal(got, want) {
		t.Fatalf("delta JSON mismatch\n--- got ---\n%s--- want ---\n%s", got, want)
	}
}

func TestIndexDeltaMessagesEmitsLintOnlyChange(t *testing.T) {
	t.Parallel()

	const file = "src/writer.ts"
	source := []store.IndexSourceFile{{File: file, Status: "indexed"}}
	previous := store.IndexData{Sources: source}
	current := store.IndexData{
		Sources: source,
		LintFindings: []store.IndexLintFinding{{
			ID:       "lint:new",
			RuleID:   "prompt.missing_input_schema",
			Source:   &store.SourceLoc{File: file, Line: 3},
			Profiles: []string{},
			Evidence: []store.IndexLintEvidence{},
			Fixes:    []store.IndexLintFix{},
		}},
	}

	messages := indexDeltaMessages(previous, current, 2)
	if len(messages) != 1 {
		t.Fatalf("delta count = %d, want 1 for lint-only change", len(messages))
	}
	if messages[0].Lints == nil || len(messages[0].Lints.Findings) != 1 {
		t.Fatalf("delta lints = %#v, want one replacement finding", messages[0].Lints)
	}
}

func TestIndexDeltaMessageClearsFileLintsWithEmptyReplacement(t *testing.T) {
	t.Parallel()

	const file = "src/writer.ts"
	previous := store.IndexData{
		Sources: []store.IndexSourceFile{{File: file, Status: "indexed"}},
		LintFindings: []store.IndexLintFinding{{
			ID:     "lint:removed",
			RuleID: "prompt.missing_input_schema",
			Source: &store.SourceLoc{File: file, Line: 3},
		}},
	}
	current := store.IndexData{Sources: previous.Sources}

	messages := indexDeltaMessages(previous, current, 3)
	if len(messages) != 1 || messages[0].Lints == nil {
		t.Fatalf("deltas = %#v, want one lint replacement", messages)
	}
	encoded, err := json.Marshal(messages[0].Lints)
	if err != nil {
		t.Fatalf("marshal lint replacement: %v", err)
	}
	if string(encoded) != `{"findings":[]}` {
		t.Fatalf("lint replacement JSON = %s, want an empty findings array", encoded)
	}
}

func TestIndexDeltaMessageOmitsUnchangedLints(t *testing.T) {
	t.Parallel()

	const file = "src/writer.ts"
	findings := []store.IndexLintFinding{{
		ID:     "lint:unchanged",
		RuleID: "prompt.missing_input_schema",
		Source: &store.SourceLoc{File: file, Line: 3},
	}}
	previous := store.IndexData{
		Sources:      []store.IndexSourceFile{{File: file, Status: "indexed"}},
		LintFindings: findings,
	}
	current := store.IndexData{
		Sources:      []store.IndexSourceFile{{File: file, Status: "indexed", SourceHash: "new"}},
		LintFindings: findings,
	}

	messages := indexDeltaMessages(previous, current, 4)
	if len(messages) != 1 {
		t.Fatalf("delta count = %d, want 1", len(messages))
	}
	if messages[0].Lints != nil {
		t.Fatalf("delta lints = %#v, want omitted unchanged section", messages[0].Lints)
	}
}

func TestIndexDeltaMessagesUsesEmptyAnchorForProjectLints(t *testing.T) {
	t.Parallel()

	current := store.IndexData{LintFindings: []store.IndexLintFinding{{
		ID:     "lint:project",
		RuleID: "project.example",
	}}}

	messages := indexDeltaMessages(store.IndexData{}, current, 5)
	if len(messages) != 1 {
		t.Fatalf("delta count = %d, want 1", len(messages))
	}
	if messages[0].File != "" {
		t.Fatalf("delta file = %q, want project-level empty anchor", messages[0].File)
	}
	if messages[0].Lints == nil || len(messages[0].Lints.Findings) != 1 {
		t.Fatalf("delta lints = %#v, want project-level replacement", messages[0].Lints)
	}
}
