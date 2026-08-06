package mapping

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

func TestDiagnosticConformanceFixtures(t *testing.T) {
	entries, err := os.ReadDir("testdata")
	if err != nil {
		t.Fatal(err)
	}
	mapper := New(Options{
		Root: "/workspace", ConfigFile: "/workspace/crux.config.ts",
		Definition: func(id string) (api.ProjectDefinition, bool) {
			if id != "prompt:def" && id != "session:support" {
				return api.ProjectDefinition{}, false
			}
			endLine, startColumn, endColumn := 4, 2, 5
			return api.ProjectDefinition{ID: id, SourceSnippet: &api.SourceSnippet{Range: api.SourceRange{
				File: "src/file.ts", StartLine: 2, EndLine: &endLine,
				StartColumn: &startColumn, EndColumn: &endColumn,
			}}}, true
		},
	})
	count := 0
	for _, entry := range entries {
		if !strings.HasSuffix(entry.Name(), ".finding.json") {
			continue
		}
		count++
		name := strings.TrimSuffix(entry.Name(), ".finding.json")
		t.Run(name, func(t *testing.T) {
			finding := readFindingFixture(t, entry.Name())
			includeSuppressed := strings.Contains(name, "suppressed-included")
			selected := FilterFindings([]api.IndexLintFinding{finding}, FilterOptions{IncludeSuppressed: includeSuppressed})
			expected := readDiagnosticFixture(t, name+".diagnostic.json")
			if len(selected) == 0 {
				if string(expected) != "null" {
					t.Fatalf("filtered finding expected %s, want null", expected)
				}
				return
			}
			_, diagnostic := mapper.Map(selected[0])
			var want protocol.Diagnostic
			if err := json.Unmarshal(expected, &want); err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(diagnostic, want) {
				gotJSON, _ := json.MarshalIndent(diagnostic, "", "  ")
				t.Fatalf("diagnostic mismatch\n--- got ---\n%s\n--- want ---\n%s", gotJSON, expected)
			}
		})
	}
	if count < 14 {
		t.Fatalf("conformance fixture count = %d, want at least 14", count)
	}
}

func readFindingFixture(t *testing.T, name string) api.IndexLintFinding {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("testdata", name))
	if err != nil {
		t.Fatal(err)
	}
	var finding api.IndexLintFinding
	if err := json.Unmarshal(data, &finding); err != nil {
		t.Fatal(err)
	}
	return finding
}

func readDiagnosticFixture(t *testing.T, name string) json.RawMessage {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("testdata", name))
	if err != nil {
		t.Fatal(err)
	}
	return json.RawMessage(strings.TrimSpace(string(data)))
}
