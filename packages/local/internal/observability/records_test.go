package observability

import (
	"encoding/json"
	"reflect"
	"strings"
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

func TestRecordUnmarshalPreservesUnknownPrivacyFieldInRawPayload(t *testing.T) {
	raw := []byte(`{
		"schemaVersion": 4,
		"recordId": "rec_privacy_forward_compat",
		"type": "run:start",
		"operationId": "run_privacy_forward_compat",
		"runId": "run_privacy_forward_compat",
		"segmentId": "seg_privacy_forward_compat",
		"segmentSeq": 1,
		"name": "privacy forward compatibility",
		"rootPrimitive": "custom.operation",
		"startedAt": "2026-07-28T00:00:00.000Z",
		"status": "running",
		"privacy": {
			"redaction": {
				"applied": true,
				"surfaces": ["attributes"]
			}
		}
	}`)

	var record Record
	if err := json.Unmarshal(raw, &record); err != nil {
		t.Fatalf("unmarshal record with optional privacy evidence: %v", err)
	}
	if !json.Valid(record.Payload) {
		t.Fatalf("raw payload is not valid JSON: %s", record.Payload)
	}
	var payload map[string]json.RawMessage
	if err := json.Unmarshal(record.Payload, &payload); err != nil {
		t.Fatalf("decode preserved payload: %v", err)
	}
	if _, ok := payload["privacy"]; !ok {
		t.Fatalf("privacy field was not preserved in raw payload: %s", record.Payload)
	}
}

func TestRecordUnmarshalNormalizesKnownRedactionSurfaces(t *testing.T) {
	raw := []byte(`{
		"schemaVersion": 4,
		"recordId": "rec_privacy_normalized",
		"type": "run:start",
		"operationId": "run_privacy_normalized",
		"runId": "run_privacy_normalized",
		"privacy": {
			"redaction": {
				"applied": true,
				"surfaces": [
					"error.message",
					"future.surface",
					"artifact.preview",
					"error.message"
				]
			}
		}
	}`)

	var record Record
	if err := json.Unmarshal(raw, &record); err != nil {
		t.Fatalf("unmarshal record with version-skewed privacy evidence: %v", err)
	}
	if record.Privacy == nil {
		t.Fatal("normalized privacy evidence is absent")
	}
	got := record.Privacy.Redaction.Surfaces
	want := []ObservabilityRedactionSurface{
		RedactionSurfaceArtifactPreview,
		RedactionSurfaceErrorMessage,
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("normalized surfaces = %#v, want %#v", got, want)
	}
	if !strings.Contains(string(record.Payload), `"future.surface"`) {
		t.Fatalf("raw payload lost forward-compatible surface: %s", record.Payload)
	}
}

func TestRecordUnmarshalDropsPrivacyWithOnlyUnknownRedactionSurfaces(t *testing.T) {
	raw := []byte(`{
		"schemaVersion": 4,
		"recordId": "rec_privacy_unknown_only",
		"type": "run:start",
		"operationId": "run_privacy_unknown_only",
		"runId": "run_privacy_unknown_only",
		"privacy": {
			"redaction": {
				"applied": true,
				"surfaces": ["future.surface"]
			}
		}
	}`)

	var record Record
	if err := json.Unmarshal(raw, &record); err != nil {
		t.Fatalf("unmarshal record with future-only privacy evidence: %v", err)
	}
	if record.Privacy != nil {
		t.Fatalf("privacy = %#v, want nil after all surfaces were rejected", record.Privacy)
	}
	if !strings.Contains(string(record.Payload), `"future.surface"`) {
		t.Fatalf("raw payload lost forward-compatible surface: %s", record.Payload)
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

func TestEvidenceEdgeRequiresRoleCorrelatedQualifiedAttributes(t *testing.T) {
	valid := mustRecord(t, `{
		"schemaVersion": 5,
		"recordId": "rec_evidence_edge",
		"type": "edge",
		"runId": "run_evidence",
		"operationId": "run_evidence",
		"segmentId": "seg_evidence",
		"segmentSeq": 1,
		"edgeId": "edge_evidence",
		"edgeType": "evidence.for",
		"from": {"kind": "artifact", "id": "artifact_source"},
		"to": {"kind": "span", "id": "1111111111111111"},
		"createdAt": "2026-07-28T12:00:00Z",
		"attributes": {
			"evidenceId": "evidence_2222222222222222",
			"role": "verification",
			"evidenceKind": "score.report",
			"conclusion": "passed",
			"recordedAt": "2026-07-28T12:00:00Z",
			"producer": {"kind": "span", "id": "1111111111111111"},
			"captureState": "reference",
			"sourceMode": "reference"
		}
	}`)
	if err := ValidateRecord(valid); err != nil {
		t.Fatalf("valid evidence edge failed validation: %v", err)
	}

	var edge EdgeRecord
	if err := json.Unmarshal(valid.Payload, &edge); err != nil {
		t.Fatal(err)
	}
	edge.Attributes = json.RawMessage(`{
		"evidenceId": "evidence_2222222222222222",
		"role": "change",
		"evidenceKind": "score.report",
		"conclusion": "passed",
		"recordedAt": "2026-07-28T12:00:00Z",
		"producer": {"kind": "span", "id": "1111111111111111"}
	}`)
	invalidPayload, err := json.Marshal(edge)
	if err != nil {
		t.Fatal(err)
	}
	valid.Payload = invalidPayload
	if err := ValidateRecord(valid); err == nil {
		t.Fatal("expected a mismatched evidence role/conclusion to fail")
	}

	for name, attributes := range map[string]string{
		"missing source mode": `{
			"evidenceId": "evidence_2222222222222222",
			"role": "verification",
			"evidenceKind": "score.report",
			"recordedAt": "2026-07-28T12:00:00Z",
			"producer": {"kind": "span", "id": "1111111111111111"},
			"captureState": "reference"
		}`,
		"missing capture state": `{
			"evidenceId": "evidence_2222222222222222",
			"role": "verification",
			"evidenceKind": "score.report",
			"recordedAt": "2026-07-28T12:00:00Z",
			"producer": {"kind": "span", "id": "1111111111111111"},
			"sourceMode": "reference"
		}`,
		"reference source with available capture": `{
			"evidenceId": "evidence_2222222222222222",
			"role": "verification",
			"evidenceKind": "score.report",
			"recordedAt": "2026-07-28T12:00:00Z",
			"producer": {"kind": "span", "id": "1111111111111111"},
			"captureState": "available",
			"idempotencyKeyHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			"sourceMode": "reference",
			"contentDigestVersion": 1,
			"contentDigest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
		}`,
		"producer extra field": `{
			"evidenceId": "evidence_2222222222222222",
			"role": "verification",
			"evidenceKind": "score.report",
			"recordedAt": "2026-07-28T12:00:00Z",
			"producer": {"kind": "span", "id": "1111111111111111", "delegatedBy": "run_private"}
		}`,
		"inline source without capture state": `{
			"evidenceId": "evidence_2222222222222222",
			"role": "verification",
			"evidenceKind": "score.report",
			"recordedAt": "2026-07-28T12:00:00Z",
			"producer": {"kind": "span", "id": "1111111111111111"},
			"idempotencyKeyHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			"sourceMode": "inline",
			"contentDigestVersion": 1,
			"contentDigest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
		}`,
	} {
		t.Run(name, func(t *testing.T) {
			edge.Attributes = json.RawMessage(attributes)
			invalidPayload, err := json.Marshal(edge)
			if err != nil {
				t.Fatal(err)
			}
			valid.Payload = invalidPayload
			if err := ValidateRecord(valid); err == nil {
				t.Fatalf("expected %s to fail", name)
			}
		})
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
