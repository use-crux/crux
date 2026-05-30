package observability

import (
	"encoding/json"
	"os"
	"testing"
)

func TestSharedGenerationFixtureDecodes(t *testing.T) {
	raw, err := os.ReadFile("../../../core/observability/fixtures/generation-run.json")
	if err != nil {
		t.Fatal(err)
	}

	var batch Batch
	if err := json.Unmarshal(raw, &batch); err != nil {
		t.Fatal(err)
	}

	if got, want := len(batch.Records), 9; got != want {
		t.Fatalf("record count = %d, want %d", got, want)
	}
	for _, record := range batch.Records {
		assertValidFixtureRecord(t, record)
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
}

func TestValidateRecordRejectsInvalidSemantics(t *testing.T) {
	raw, err := os.ReadFile("../../../core/observability/fixtures/generation-run.json")
	if err != nil {
		t.Fatal(err)
	}

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

func assertValidFixtureRecord(t *testing.T, record Record) {
	t.Helper()
	if record.SchemaVersion != SchemaVersion {
		t.Fatalf("record %s schemaVersion = %d, want %d", record.RecordID, record.SchemaVersion, SchemaVersion)
	}
	if record.RunID != "run_generation_fixture_01" {
		t.Fatalf("record %s runId = %q", record.RecordID, record.RunID)
	}
	if len(record.Payload) == 0 {
		t.Fatalf("record %s did not preserve raw payload", record.RecordID)
	}
	if err := ValidateRecord(record); err != nil {
		t.Fatalf("record %s failed validation: %v", record.RecordID, err)
	}
}
