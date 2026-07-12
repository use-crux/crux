package model

import (
	"bytes"
	"encoding/json"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestMediaFactsRoundTripThroughGenericFactEnvelopes(t *testing.T) {
	metadata := json.RawMessage(`{"facts":{"kind":"media.operation","operation":"generateImage","outputModalities":["image"],"adapter":"google","execution":"unknown","authoredOptions":{"n":2}}}`)
	findingData := json.RawMessage(`{"source":"semantic","fidelity":"resolved","adapter":"google","capability":"generateImage"}`)
	patch := IndexPatch{SchemaVersion: 2, Phase: PhaseSemantic, Project: store.ProjectIdentity{Root: "/repo", Name: "media"}, Status: "ok", Facts: IndexPatchFacts{
		Definitions: []store.ProjectDefinition{{ID: "media.operation:cover", Kind: "media.operation", Name: "cover", Fidelity: "resolved", Status: "active", Metadata: metadata}},
		Relations:   []store.ProjectRelation{{ID: "relation:media-route", Type: "media.uses_routing", From: "media.operation:cover", To: "routing.router:vision", Fidelity: "resolved"}},
		LintFindings: []store.IndexLintFinding{{
			ID: "media.output-discarded:cover", RuleID: "media.output-discarded", Severity: "warning", Category: "quality",
			Maturity: "experimental", Confidence: "high", Profiles: []string{"recommended", "strict"}, Title: "Media output is discarded",
			Message: "Consume the canonical result.", Rationale: "Resolved authored evidence.", Impact: "The media result is lost.",
			PrimaryDefinitionID: "media.operation:cover", Evidence: []store.IndexLintEvidence{{Kind: "source", Label: "Resolved media evidence", Data: findingData}},
			Fixes: []store.IndexLintFix{{Title: "Consume the result", Description: "Read content or messages.", Kind: "manual"}},
		}},
	}}

	facts, err := indexPatchFactsFromEnvelopes(FactTransactionFromPatch(patch).Facts)
	if err != nil {
		t.Fatalf("round trip media facts: %v", err)
	}
	if len(facts.Definitions) != 1 || !bytes.Equal(facts.Definitions[0].Metadata, metadata) {
		t.Fatalf("definitions = %+v, want safe media metadata preserved", facts.Definitions)
	}
	if len(facts.Relations) != 1 || facts.Relations[0].Type != "media.uses_routing" {
		t.Fatalf("relations = %+v, want media routing relation", facts.Relations)
	}
	if len(facts.LintFindings) != 1 || !bytes.Equal(facts.LintFindings[0].Evidence[0].Data, findingData) {
		t.Fatalf("lint findings = %+v, want media evidence and remediation", facts.LintFindings)
	}
	encoded, err := json.Marshal(facts)
	if err != nil {
		t.Fatalf("marshal projected facts: %v", err)
	}
	if bytes.Contains(encoded, []byte("private-file-id")) || bytes.Contains(encoded, []byte("private-ref")) {
		t.Fatalf("projected facts contain private media locator: %s", encoded)
	}
}
