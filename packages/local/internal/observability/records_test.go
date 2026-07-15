package observability

import (
	"encoding/json"
	"testing"
)

func TestSharedGenerationFixtureDecodes(t *testing.T) {
	raw := readCoreObservabilityFixture(t, "generation-run.json")

	var batch Batch
	if err := json.Unmarshal(raw, &batch); err != nil {
		t.Fatal(err)
	}
	runID := batch.Records[0].RunID

	if got, want := len(batch.Records), 13; got != want {
		t.Fatalf("record count = %d, want %d", got, want)
	}
	for _, record := range batch.Records {
		assertValidFixtureRecord(t, record, runID)
	}

	var span SpanStartRecord
	if err := json.Unmarshal(batch.Records[1].Payload, &span); err != nil {
		t.Fatal(err)
	}
	if span.Type != RecordSpanStart {
		t.Fatalf("span type = %q, want %q", span.Type, RecordSpanStart)
	}
	if span.Primitive != "generation.call" {
		t.Fatalf("span primitive = %q, want generation.call", span.Primitive)
	}
	if span.Model != "gpt-4o" || span.Provider != "openai" {
		t.Fatalf("span model/provider = %q/%q", span.Model, span.Provider)
	}

	var artifact ArtifactRecord
	if err := json.Unmarshal(batch.Records[2].Payload, &artifact); err != nil {
		t.Fatal(err)
	}
	if artifact.Kind != "messages" {
		t.Fatalf("artifact kind = %q, want messages", artifact.Kind)
	}

	var edge EdgeRecord
	if err := json.Unmarshal(batch.Records[3].Payload, &edge); err != nil {
		t.Fatal(err)
	}
	if edge.EdgeType != "consumed" {
		t.Fatalf("edge type = %q, want consumed", edge.EdgeType)
	}
	if edge.From.Kind != "span" || edge.To.Kind != "artifact" {
		t.Fatalf("edge refs = %s -> %s, want span -> artifact", edge.From.Kind, edge.To.Kind)
	}

	var contextContribution ArtifactRecord
	if err := json.Unmarshal(batch.Records[4].Payload, &contextContribution); err != nil {
		t.Fatal(err)
	}
	if contextContribution.Kind != "context.contribution" {
		t.Fatalf("context artifact kind = %q, want context.contribution", contextContribution.Kind)
	}

	var promptBudget ArtifactRecord
	if err := json.Unmarshal(batch.Records[6].Payload, &promptBudget); err != nil {
		t.Fatal(err)
	}
	if promptBudget.Kind != "prompt.budget" {
		t.Fatalf("prompt artifact kind = %q, want prompt.budget", promptBudget.Kind)
	}
}

func TestValidateRecordRejectsInvalidSemantics(t *testing.T) {
	raw := readCoreObservabilityFixture(t, "generation-run.json")

	var batch Batch
	if err := json.Unmarshal(raw, &batch); err != nil {
		t.Fatal(err)
	}

	span := batch.Records[1]
	span.Payload = []byte(`{
		"schemaVersion": 1,
		"recordId": "rec_invalid_family",
		"type": "span:start",
		"runId": "run_generation_fixture_01",
		"spanId": "span_invalid_family",
		"family": "tool",
		"primitive": "generation.call",
		"name": "invalid",
		"startedAt": "2026-05-16T18:00:00.000Z",
		"status": "running"
	}`)
	if err := ValidateRecord(span); err == nil {
		t.Fatal("expected invalid family/primitive combination to fail")
	}

	edge := batch.Records[3]
	edge.Payload = []byte(`{
		"schemaVersion": 1,
		"recordId": "rec_invalid_edge",
		"type": "edge",
		"runId": "run_generation_fixture_01",
		"edgeId": "edge_invalid",
		"edgeType": "app_relation",
		"from": { "kind": "span", "id": "span_generation_fixture_01" },
		"to": { "kind": "artifact", "id": "artifact_generation_input_01" },
		"createdAt": "2026-05-16T18:00:00.016Z"
	}`)
	if err := ValidateRecord(edge); err == nil {
		t.Fatal("expected un-namespaced custom edge type to fail")
	}
}

func TestRoutingStableBetaPrimitiveTaxonomy(t *testing.T) {
	for _, primitive := range []string{
		"routing.router",
		"routing.split",
		"routing.retry",
		"routing.fallback",
		"routing.cascade",
	} {
		if got := primitiveFamilyByName[primitive]; got != "routing" {
			t.Fatalf("primitive %q family = %q, want routing", primitive, got)
		}
	}
	if _, ok := canonicalEdgeTypes["fallback.attempt"]; !ok {
		t.Fatal("fallback.attempt edge must remain canonical for fallback attempt links")
	}
	if _, ok := canonicalArtifactKinds["routing.report"]; !ok {
		t.Fatal("routing.report artifact must remain canonical for routing receipts")
	}
}

func assertValidFixtureRecord(t *testing.T, record Record, runID string) {
	t.Helper()
	if !IsSupportedSchemaVersion(record.SchemaVersion) {
		t.Fatalf("record %s schemaVersion = %d is unsupported", record.RecordID, record.SchemaVersion)
	}
	if record.RunID != runID {
		t.Fatalf("record %s runId = %q", record.RecordID, record.RunID)
	}
	if len(record.Payload) == 0 {
		t.Fatalf("record %s did not preserve raw payload", record.RecordID)
	}
	if err := ValidateRecord(record); err != nil {
		t.Fatalf("record %s failed validation: %v", record.RecordID, err)
	}
}
