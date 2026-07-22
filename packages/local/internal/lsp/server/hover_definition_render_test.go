package server

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

func TestBuildHoverMatchesDefinitionGoldens(t *testing.T) {
	t.Parallel()

	definition := documentDefinition{
		Definition: api.ProjectDefinition{
			ID: "prompt:writer", Name: "Writer [primary]", Kind: "prompt", Description: "Writes *carefully*.",
		},
		Range: protocol.Range{Start: protocol.Position{Line: 4, Character: 2}, End: protocol.Position{Line: 7}},
	}
	tests := []struct {
		name     string
		findings []displayedFinding
		summary  definitionSummary
		golden   string
	}{
		{
			name: "combined", findings: []displayedFinding{hoverFinding("rule.alpha", "Alpha")},
			summary: definitionSummary{
				Definition: definition, FindingCount: 2, IncomingRelations: 1, OutgoingRelations: 3,
			},
			golden: "hover-definition-combined.md",
		},
		{
			name: "definition only", summary: definitionSummary{
				Definition: definition, FindingCount: 1, IncomingRelations: 0, OutgoingRelations: 1,
			},
			golden: "hover-definition-only.md",
		},
		{
			name: "zero findings", summary: definitionSummary{
				Definition: definition, IncomingRelations: 2, OutgoingRelations: 0,
			},
			golden: "hover-definition-zero.md",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			hover := buildHoverWithDefinition(test.findings, &test.summary, protocol.MarkupKindMarkdown)
			want, err := os.ReadFile(filepath.Join("testdata", test.golden))
			if err != nil {
				t.Fatal(err)
			}
			if hover.Contents.Value != strings.TrimSuffix(string(want), "\n") {
				t.Fatalf("hover mismatch\n--- got ---\n%s\n--- want ---\n%s", hover.Contents.Value, want)
			}
			wantRange := definition.Range
			if len(test.findings) > 0 {
				wantRange = test.findings[0].Diagnostic.Range
			}
			if hover.Range == nil || *hover.Range != wantRange {
				t.Fatalf("hover range = %#v, want %#v", hover.Range, wantRange)
			}
		})
	}
}

func TestBuildHoverCapsDefinitionSectionAfterFindingContent(t *testing.T) {
	t.Parallel()

	finding := hoverFinding("long", "Long finding")
	finding.Finding.Message = strings.Repeat("x", 3_900)
	summary := definitionSummary{Definition: documentDefinition{
		Definition: api.ProjectDefinition{
			ID: "prompt:writer", Name: strings.Repeat("writer", 100), Kind: "prompt",
		},
	}}
	hover := buildHoverWithDefinition([]displayedFinding{finding}, &summary, protocol.MarkupKindMarkdown)
	if got := utf16Units(hover.Contents.Value); got > maxHoverUTF16Units {
		t.Fatalf("hover UTF-16 units = %d, want <= %d", got, maxHoverUTF16Units)
	}
	if !strings.HasPrefix(hover.Contents.Value, "**Long finding**") || !strings.HasSuffix(hover.Contents.Value, "…** — prompt") {
		t.Fatalf("definition was not truncated as the final section: %q", hover.Contents.Value)
	}
}
