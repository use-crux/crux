package screens

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
)

func TestIndexSchemaProjectionRendersNestedFieldsInsteadOfRawJSON(t *testing.T) {
	definition := api.ProjectDefinition{
		ID: "prompt:schema", Kind: "prompt", Name: "schema",
		Metadata: json.RawMessage(`{
			"inputSchema":{"type":"object","properties":{
				"question":{"type":"string","description":"Customer question"},
				"options":{"type":"object","properties":{"locale":{"type":"string"}},"required":["locale"]}
			},"required":["question"]},
			"outputSchema":{"type":"object","properties":{
				"citations":{"type":"array","items":{"type":"string"}}
			},"required":["citations"]}
		}`),
	}
	document := stripANSI(renderIndexDefinitionDocument(api.IndexData{}, definition))
	for _, want := range []string{
		"CONTRACT", "INPUT", "question  string  required  — Customer question",
		"  locale  string  required", "OUTPUT", "citations  array<string>  required",
	} {
		if !strings.Contains(document, want) {
			t.Fatalf("schema field tree omitted %q:\n%s", want, document)
		}
	}
	if strings.Contains(document, `"properties"`) {
		t.Fatalf("schema detail exposed raw JSON Schema:\n%s", document)
	}
}

func TestIndexLintProjectionIncludesEvidenceFixesPropagationAndSuppressedCount(t *testing.T) {
	definition := api.ProjectDefinition{ID: "agent:support", Kind: "agent", Name: "support"}
	index := api.IndexData{
		Definitions: []api.ProjectDefinition{definition},
		LintFindings: []api.IndexLintFinding{
			{
				ID: "active", Severity: "warning", RuleID: "agent.unobservable_handoff",
				Category: "observability", Maturity: "preview", Confidence: "medium",
				Title: "Missing handoff", Message: "Target is absent.", Rationale: "Keep traces connected.",
				PrimaryDefinitionID: definition.ID,
				Evidence: []api.IndexLintEvidence{{
					Kind: "relation", Label: "Missing target", RelationID: "relation:handoff",
					Data: json.RawMessage(`{"to":"agent:manager"}`),
				}},
				Fixes: []api.IndexLintFix{
					{Kind: "manual", Title: "Add target", Description: "Export the manager."},
					{Kind: "docs", Title: "Read docs", DocsURL: "/docs/handoff"},
				},
				PropagationPaths: []api.IndexLintPropagationPath{{
					FromDefinitionID: "flow:support", ToDefinitionID: definition.ID,
					RelationTypes: []string{"flow.step.uses_agent"},
				}},
			},
			{
				ID: "suppressed", RuleID: "agent.intentional", Suppressed: true,
				PrimaryDefinitionID: definition.ID,
			},
		},
	}
	document := stripANSI(buildIndexDefinitionDocument(index, definition, 100).content)
	for _, want := range []string{
		"LINT · 1 ACTIVE · 1 SUPPRESSED", "warning · agent.unobservable_handoff",
		"observability · preview · medium", "Missing target", `{"to":"agent:manager"}`,
		"fix 1", "Add target", "fix 2", "Read docs",
		"flow:support → agent:support · flow.step.uses_agent",
	} {
		if !strings.Contains(document, want) {
			t.Fatalf("full lint detail omitted %q:\n%s", want, document)
		}
	}
	if strings.Contains(document, "agent.intentional") {
		t.Fatalf("suppressed finding rendered while toggle was off:\n%s", document)
	}

	expanded := stripANSI(buildIndexDefinitionDocumentWithOptions(
		index, definition, 100, indexDefinitionDetailOptions{showSuppressed: true},
	).content)
	if !strings.Contains(expanded, "agent.intentional · suppressed") {
		t.Fatalf("suppressed toggle did not reveal finding:\n%s", expanded)
	}

	suppressedOnly := index
	suppressedOnly.LintFindings = index.LintFindings[1:]
	collapsed := stripANSI(buildIndexDefinitionDocument(suppressedOnly, definition, 100).content)
	if !strings.Contains(collapsed, "LINT · 0 ACTIVE · 1 SUPPRESSED") ||
		strings.Contains(collapsed, "agent.intentional") {
		t.Fatalf("suppressed-only lint did not advertise its hidden count:\n%s", collapsed)
	}
}

func TestIndexHeroesRelationsAndPromptTextProjection(t *testing.T) {
	definition := api.ProjectDefinition{
		ID: "agent:support", Kind: "agent", Name: "support",
		SourceRefs: []api.ProjectSourceRef{{
			ID: "ref:prompt", Role: "prompt", Fidelity: "resolved",
			Metadata: map[string]any{"promptText": map[string]any{
				"tag": "md", "language": "markdown", "lifecycle": "static", "sourceKind": "owner",
				"fragmentJoins": []any{map[string]any{
					"interpolationIndex": float64(0), "targetSourceRefId": "ref:fragment",
				}},
			}},
		}},
	}
	index := api.IndexData{
		Definitions: []api.ProjectDefinition{
			definition,
			{ID: "flow:caller", Kind: "flow", Name: "caller"},
			{ID: "prompt:support", Kind: "prompt", Name: "support prompt"},
			{ID: "tool:search", Kind: "tool", Name: "search"},
			{ID: "agent:manager", Kind: "agent", Name: "manager"},
		},
		Relations: []api.ProjectRelation{
			{Type: "flow.step.uses_agent", From: "flow:caller", To: definition.ID},
			{Type: "agent.uses_prompt", From: definition.ID, To: "prompt:support"},
			{Type: "agent.uses_tool", From: definition.ID, To: "tool:search"},
			{Type: "agent.can_handoff_to", From: definition.ID, To: "agent:manager"},
		},
	}
	document := stripANSI(renderIndexDefinitionDocument(index, definition))
	for _, want := range []string{
		"AGENT LOOP", "prompt support prompt  →  tools search  →  handoffs manager",
		"PROMPTTEXT · CANONICAL MD · MARKDOWN", "owner · prompt · static · markdown · ref:prompt",
		"#0 · → ref:fragment", "USED BY · 1", "DEPENDS ON · 3",
		"flow.step.uses_agent", "agent.uses_prompt",
	} {
		if !strings.Contains(document, want) {
			t.Fatalf("catalog depth omitted %q:\n%s", want, document)
		}
	}

	flow := api.ProjectDefinition{
		ID: "flow:refund", Kind: "flow", Name: "refund",
		Metadata: json.RawMessage(`{"stepNames":["research","draft","review"]}`),
	}
	flowDocument := stripANSI(renderIndexDefinitionDocument(api.IndexData{}, flow))
	if !strings.Contains(flowDocument, "1 research  →  2 draft  →  3 review") {
		t.Fatalf("flow hero omitted ordered step names:\n%s", flowDocument)
	}
}
