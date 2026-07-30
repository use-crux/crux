package screens

import (
	"strings"
	"testing"

	"charm.land/lipgloss/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/uitest"
)

func TestIndexGoldens(t *testing.T) {
	cases := []struct {
		name   string
		width  int
		height int
	}{
		{name: "index-70x24", width: 70, height: 24},
		{name: "index-100x30", width: 100, height: 30},
		{name: "index-160x45", width: 160, height: 45},
		{name: "index-59x19", width: 59, height: 19},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			index := fixtureIndex()
			index.Resize(Size{Width: tc.width, Height: tc.height})
			uitest.Golden(t, tc.name, index.View(Size{Width: tc.width, Height: tc.height}))
		})
	}
}

func TestIndexSupportedLayoutsAreExactlyBounded(t *testing.T) {
	for _, size := range []Size{{Width: 70, Height: 24}, {Width: 100, Height: 30}, {Width: 160, Height: 45}, {Width: 59, Height: 19}} {
		index := fixtureIndex()
		index.Resize(size)
		view := index.View(size)
		lines := strings.Split(view, "\n")
		if len(lines) != size.Height {
			t.Fatalf("%dx%d line count = %d, want %d", size.Width, size.Height, len(lines), size.Height)
		}
		for lineIndex, line := range lines {
			if width := lipgloss.Width(line); width != size.Width {
				t.Fatalf("%dx%d line %d width = %d, want %d", size.Width, size.Height, lineIndex+1, width, size.Width)
			}
		}
	}
}

func TestIndexFuzzResize(t *testing.T) {
	index := fixtureIndex()
	uitest.FuzzResize(t, func(width, height int) string {
		index.Resize(Size{Width: width, Height: height})
		return index.View(Size{Width: width, Height: height})
	})
}

func TestIndexDetailRendersProjectRelativePaths(t *testing.T) {
	const projectRoot = "/workspace/customer-support"
	column := 16
	definition := api.ProjectDefinition{
		ID:   "eval:model-backed",
		Kind: "eval",
		Name: "model-backed",
		Source: &api.SourceLoc{
			File:   projectRoot + "/evals/nested/model-backed.example.ts",
			Line:   13,
			Column: &column,
		},
	}
	document := stripANSI(buildIndexDefinitionDocument(api.IndexData{
		Project: &api.ProjectIdentity{Root: projectRoot},
	}, definition, 52).content)

	if strings.Contains(document, projectRoot) {
		t.Fatalf("index detail leaked absolute project prefix:\n%s", document)
	}
	if !strings.Contains(document, "model-backed.example.ts:13:16") {
		t.Fatalf("index detail lost filename and source coordinates:\n%s", document)
	}
}

func fixtureIndex() *Index {
	column := 7
	endLine := 18
	index := NewIndex()
	index.SetIndexForTest(api.IndexData{
		Definitions: []api.ProjectDefinition{
			{
				ID:          "prompt:writer.prompt",
				Kind:        "prompt",
				Name:        "writer.prompt",
				Description: "Writes a concise answer from retrieved evidence without losing exact citations.",
				Tags:        []string{"production", "documentation"},
				Path:        []string{"agents", "docs", "writer"},
				Fidelity:    "resolved",
				Status:      "active",
				Fingerprint: "sha256:3d10d21e3ccda26024a3b95bacebe0f86d3ad55f",
				Source:      &api.SourceLoc{File: "src/agents/documentation/very-long-writer-prompt.ts", Line: 12, Column: &column, Function: "writerPrompt"},
				SourceSnippet: &api.SourceSnippet{
					Source:    "export const writerPrompt = definePrompt({\n  name: 'writer.prompt',\n  system: 'Answer with grounded citations — never invent evidence.',\n})",
					Language:  "typescript",
					Range:     api.SourceRange{File: "src/agents/documentation/very-long-writer-prompt.ts", StartLine: 12, EndLine: &endLine},
					Truncated: true,
				},
				SourceRefs: []api.ProjectSourceRef{
					{ID: "ref:model", Role: "model", Property: "model", Symbol: "fastModel", Source: api.SourceLoc{File: "src/agents/documentation/models.ts", Line: 4}, Fidelity: "resolved"},
				},
			},
			{ID: "context:docs", Kind: "context", Name: "docs context", Fidelity: "resolved"},
			{ID: "tool:search", Kind: "tool", Name: "search", Fidelity: "partial"},
			{ID: "agent:docs", Kind: "agent", Name: "docs agent", Fidelity: "resolved"},
			{ID: "eval:grounding", Kind: "eval", Name: "grounding eval", Fidelity: "error"},
		},
		LintFindings: []api.IndexLintFinding{
			{PrimaryDefinitionID: "prompt:writer.prompt", RuleID: "prompt.missing_schema", Severity: "warning", Title: "Prompt has no output schema", Rationale: "A schema keeps downstream handling deterministic."},
		},
		Relations: []api.ProjectRelation{
			{ID: "relation:writer-context", Type: "uses", From: "prompt:writer.prompt", To: "context:docs", Fidelity: "resolved"},
		},
		Diagnostics: []api.IndexDiagnostic{
			{ID: "diagnostic:writer", Code: "INDEX_SOURCE_PARTIAL", Severity: "warning", Message: "The source snippet was bounded by the indexer.", RelatedDefinitionIDs: []string{"prompt:writer.prompt"}, SuggestedFix: "Open the source file for the complete definition."},
		},
	})
	return index
}
